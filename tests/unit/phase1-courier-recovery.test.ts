import { beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic provider and serial in-memory transactions only. These tests do not
// assert that any real courier supports idempotency or cancellation semantics.
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), cancel: vi.fn(), credentials: vi.fn(), getProvider: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  courierShipment: { findUnique: (...args: unknown[]) => lookups.shipment(...args) },
  courierOperation: { findUnique: (...args: unknown[]) => lookups.operation(...args) },
  courierProviderConfiguration: { findUnique: async () => structuredClone(store.config) },
} }));
vi.mock("@/lib/couriers/registry", () => ({ getCourierProvider: mocks.getProvider }));
vi.mock("@/lib/settings", () => ({ getCourierCredentialFromSnapshot: mocks.credentials }));
vi.mock("@/services/order-lock", () => ({ lockOrder: vi.fn() }));
vi.mock("@/services/orders", () => ({
  courierClaimMarkerSchema: { safeParse: (payload: unknown) => {
    const value = payload as { landiqBooking?: unknown } | null;
    return value?.landiqBooking ? { success: true, data: { landiqBooking: value.landiqBooking } } : { success: false };
  } },
  courierConfigurationMac: () => store.config.mac,
  courierEndpointOverride: () => "https://snapshot.fixture.invalid",
  lockedCourierConfiguration: async () => structuredClone(store.config),
}));

import { reconcileCourierBooking, reconcileCourierCancellation, requestCourierCancellation } from "@/services/courier-operations";

type Marker = { version: number; state: string; sandbox: boolean; merchantReference: string; orderStatusAtClaim: string; requestFingerprint: string; configurationMac: string };
type Shipment = { id: string; orderId: string; providerCode: string; status: string; consignmentId: string | null; trackingId: string | null;
  payload: { landiqBooking: Marker; conflictingProviderResult?: unknown } };
type Operation = { id: string; shipmentId: string; kind: string; status: string; outcome: string | null; evidence: string | null;
  providerCode: string; sandbox: boolean; configurationMac: string; externalReference: string };
type Store = { order: { id: string; orderNumber: string; status: string }; shipment: Shipment; operation: Operation | null;
  config: { code: string; enabled: boolean; sandbox: boolean; credentials: object; mac: string }; events: unknown[]; audits: unknown[] };
let store: Store;
let queue: Promise<void>;
let failingUpdates: number;

const lookups = {
  shipment: async (...args: unknown[]) => {
    const value = args[0] as { where: { id: string }; include?: unknown };
    if (value.where.id !== store.shipment.id) return null;
    return value.include ? { ...structuredClone(store.shipment), order: structuredClone(store.order) } : { orderId: store.shipment.orderId };
  },
  operation: async (..._args: unknown[]) => store.operation ? structuredClone(store.operation) : null,
};

const tx = {
  courierShipment: {
    findUnique: async ({ where }: { where: { id: string } }) => where.id === store.shipment.id
      ? { ...structuredClone(store.shipment), order: structuredClone(store.order) } : null,
    findFirst: async () => null,
    update: async ({ data }: { data: Partial<Shipment> }) => structuredClone(Object.assign(store.shipment, data)),
  },
  courierOperation: {
    findUnique: async () => store.operation ? structuredClone(store.operation) : null,
    findUniqueOrThrow: async () => ({ ...structuredClone(store.operation!), shipment: structuredClone(store.shipment) }),
    create: async ({ data }: { data: Partial<Operation> & Pick<Operation, "shipmentId" | "kind" | "status" | "providerCode" | "sandbox" | "configurationMac" | "externalReference"> }) => {
      store.operation = { id: data.id ?? "manual-operation", outcome: data.outcome ?? null, evidence: data.evidence ?? null, ...data };
      return structuredClone(store.operation);
    },
    update: async ({ data }: { data: Partial<Operation> }) => {
      if (failingUpdates > 0) { failingUpdates--; throw new Error("synthetic persistence failure"); }
      return structuredClone(Object.assign(store.operation!, data));
    },
  },
  courierTrackingEvent: { create: async ({ data }: { data: unknown }) => { store.events.push(data); } },
  auditLog: { create: async ({ data }: { data: unknown }) => { store.audits.push(data); } },
};

const evidence = "Checked original account and support case 12345";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks(); queue = Promise.resolve(); failingUpdates = 0;
  store = { order: { id: "order-1", orderNumber: "ORD-1", status: "CANCELLED" },
    shipment: { id: "shipment-1", orderId: "order-1", providerCode: "fixture", status: "BOOKED", consignmentId: "consign-1", trackingId: "track-1",
      payload: { landiqBooking: { version: 4, state: "BOOKED", sandbox: true, merchantReference: "ORD-1", orderStatusAtClaim: "READY_TO_SHIP",
        requestFingerprint: "a".repeat(64), configurationMac: "bound-mac" } } },
    operation: null, config: { code: "fixture", enabled: true, sandbox: true, credentials: {}, mac: "bound-mac" }, events: [], audits: [] };
  mocks.credentials.mockResolvedValue({ apiKey: "synthetic-only" });
  mocks.getProvider.mockReturnValue({ credentialsValid: () => true, cancelShipment: mocks.cancel });
  mocks.cancel.mockResolvedValue(true);
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const prior = queue; let release!: () => void; queue = new Promise<void>((resolve) => { release = resolve; }); await prior;
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; } finally { release(); }
  });
});

describe("courier recovery and cancellation", () => {
  it("records a known booking from staff evidence without changing a cancelled order or inventory", async () => {
    store.shipment.status = "PENDING";
    store.shipment.consignmentId = null; store.shipment.trackingId = null;
    store.shipment.payload.landiqBooking.state = "OUTCOME_UNKNOWN";
    const input = { shipmentId: "shipment-1", merchantReference: "ORD-1", consignmentId: "consign-1", trackingId: "track-1",
      sandbox: true, evidence, confirmOriginalAccount: true as const };
    await reconcileCourierBooking(input, "manager");
    await reconcileCourierBooking(input, "manager");
    expect(store.order.status).toBe("CANCELLED");
    expect(store.shipment.status).toBe("BOOKED");
    expect(store.events).toHaveLength(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    await expect(reconcileCourierBooking({ ...input, consignmentId: "other" }, "manager")).rejects.toThrow(/conflict/);
  });

  it("will not claim absence from an unknown or conflicting provider response", async () => {
    store.shipment.status = "PENDING"; store.shipment.payload.landiqBooking.state = "OUTCOME_UNKNOWN";
    store.shipment.payload.conflictingProviderResult = { consignmentId: "second" };
    await expect(reconcileCourierBooking({ shipmentId: "shipment-1", merchantReference: "ORD-1", consignmentId: "consign-1", trackingId: "track-1",
      sandbox: true, evidence, confirmOriginalAccount: true }, "manager")).rejects.toThrow(/Multiple provider results/);
    expect(store.shipment.status).toBe("PENDING");
  });

  it("keeps a timed-out cancellation claim and never calls the provider again on retry", async () => {
    mocks.cancel.mockRejectedValueOnce(new Error("timeout"));
    await expect(requestCourierCancellation("shipment-1", "manager")).rejects.toThrow(/may have been sent/);
    expect(store.operation?.status).toBe("OUTCOME_UNKNOWN");
    const retry = await requestCourierCancellation("shipment-1", "manager");
    expect(retry.status).toBe("OUTCOME_UNKNOWN"); expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(store.order.status).toBe("CANCELLED");
  });

  it("does not hold a transaction over the provider call and reopens review for a late response", async () => {
    const called = deferred(); const release = deferred();
    mocks.cancel.mockImplementationOnce(async () => { called.resolve(); await release.promise; return true; });
    const pending = requestCourierCancellation("shipment-1", "manager");
    await called.promise;
    const duplicate = await requestCourierCancellation("shipment-1", "manager");
    expect(duplicate.status).toBe("AWAITING_RESULT"); expect(mocks.cancel).toHaveBeenCalledOnce();
    await reconcileCourierCancellation({ shipmentId: "shipment-1", outcome: "CANCELLED", evidence, confirmOriginalAccount: true }, "manager");
    expect(store.operation?.status).toBe("RECONCILED");
    release.resolve(); await pending;
    expect(store.operation?.status).toBe("RECONCILIATION_REQUIRED");
    expect(store.events).toHaveLength(2);
    expect(store.order.status).toBe("CANCELLED");
  });

  it("restores the prior shipment status when later evidence reverses a staff cancellation report", async () => {
    const called = deferred(); const release = deferred();
    mocks.cancel.mockImplementationOnce(async () => { called.resolve(); await release.promise; return false; });
    const pending = requestCourierCancellation("shipment-1", "manager");
    await called.promise;
    await reconcileCourierCancellation({ shipmentId: "shipment-1", outcome: "CANCELLED", evidence, confirmOriginalAccount: true }, "manager");
    expect(store.shipment.status).toBe("CANCELLED");
    release.resolve(); await pending;
    expect(store.operation?.status).toBe("RECONCILIATION_REQUIRED");
    await reconcileCourierCancellation({ shipmentId: "shipment-1", outcome: "NOT_CANCELLED",
      evidence: "Rechecked original account and support case after the late response", confirmOriginalAccount: true }, "manager");
    expect(store.operation?.status).toBe("RECONCILED");
    expect(store.operation?.outcome).toBe("STAFF_REPORTED_NOT_CANCELLED");
    expect(store.shipment.status).toBe("BOOKED");
    expect(store.events.at(-1)).toMatchObject({ status: "BOOKED", source: "STAFF_RECONCILIATION" });
    expect(store.order.status).toBe("CANCELLED");
  });

  it("keeps an old cancelled shipment under review when its previous status is unknown", async () => {
    store.shipment.status = "CANCELLED";
    store.operation = { id: "historic-operation", shipmentId: "shipment-1", kind: "CANCEL", status: "RECONCILIATION_REQUIRED",
      outcome: "STAFF_REPORTED_CANCELLED", evidence, providerCode: "fixture", sandbox: true,
      configurationMac: "bound-mac", externalReference: "consign-1" };
    await expect(reconcileCourierCancellation({ shipmentId: "shipment-1", outcome: "NOT_CANCELLED",
      evidence: "Rechecked original account and support case after the late response", confirmOriginalAccount: true }, "manager"))
      .rejects.toThrow(/previous shipment status/);
    expect(store.operation.status).toBe("RECONCILIATION_REQUIRED");
    expect(store.shipment.status).toBe("CANCELLED");
    expect(store.events).toHaveLength(0);
  });

  it.each([1, 2])("does not repeat a provider call after %s local write failure(s)", async (failureCount) => {
    failingUpdates = failureCount;
    await expect(requestCourierCancellation("shipment-1", "manager")).rejects.toThrow(/may have been sent/);
    expect(store.operation?.status).toBe(failureCount === 1 ? "RECONCILIATION_REQUIRED" : "AWAITING_RESULT");
    await requestCourierCancellation("shipment-1", "manager");
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("rejects account changes before the external call", async () => {
    store.config.mac = "different-account";
    await expect(requestCourierCancellation("shipment-1", "manager")).rejects.toThrow(/original booking\/account/);
    expect(store.operation).toBeNull(); expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("records a staff-reported cancellation separately from any warehouse receipt", async () => {
    const input = { shipmentId: "shipment-1", outcome: "CANCELLED" as const, evidence, confirmOriginalAccount: true as const };
    await reconcileCourierCancellation(input, "manager");
    await reconcileCourierCancellation(input, "manager");
    expect(store.operation?.outcome).toBe("STAFF_REPORTED_CANCELLED");
    expect(store.shipment.status).toBe("CANCELLED");
    expect(store.order.status).toBe("CANCELLED");
    expect(store.events).toHaveLength(1);
    await expect(reconcileCourierCancellation({ ...input, outcome: "NOT_CANCELLED" }, "manager")).rejects.toThrow(/different evidence/);
  });
});
