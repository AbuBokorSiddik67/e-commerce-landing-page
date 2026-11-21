import { beforeEach, describe, expect, it, vi } from "vitest";

// Two cooperating writers run through a serialized in-memory transaction fake.
// Network responses are synthetic, and no PostgreSQL concurrency is claimed.
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), createShipment: vi.fn(), credential: vi.fn(),
  sale: vi.fn(), other: vi.fn(), dispatchConflict: vi.fn(), adjust: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  courierProviderConfiguration: { findUnique: async () => structuredClone(store.config) },
  courierShipment: { findUnique: async () => store.shipment ? { orderId: store.order.id } : null },
} }));
vi.mock("@/lib/settings", () => ({ getCourierCredentialFromSnapshot: mocks.credential }));
vi.mock("@/lib/couriers/registry", () => ({ getCourierProvider: () => ({ credentialsValid: () => true, createShipment: mocks.createShipment }) }));
vi.mock("@/lib/payments/registry", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify, notifyOwners: vi.fn() }));
vi.mock("@/lib/marketing", () => ({ sendServerPurchaseEvent: vi.fn() }));
vi.mock("@/services/inventory", () => ({ adjustStock: mocks.adjust, hasRecordedOrderSale: mocks.sale, hasOtherOrderStockMovement: mocks.other }));
vi.mock("@/services/order-lock", () => ({ lockOrder: vi.fn(), hasConflictingDispatchEvidence: mocks.dispatchConflict,
  assertNoConflictingDispatchEvidence: vi.fn(), assertNoUnresolvedCourier: vi.fn(), hasUnresolvedCourier: vi.fn() }));

import { bookCourierShipment, cancelOrder } from "@/services/orders";
import { reconcileCourierBooking } from "@/services/courier-operations";

type Shipment = { id: string; orderId: string; providerCode: string; status: string; codAmount: number; cost: number;
  consignmentId: string | null; trackingId: string | null; trackingUrl: string | null; payload: Record<string, unknown> };
type Order = { id: string; orderNumber: string; customerId: string; productId: string; variantId: string; quantity: number;
  subtotal: number; deliveryCharge: number; discount: number; total: number; currency: string; status: string; paymentMethod: string;
  paymentStatus: string; paymentReference: string | null; financialStatus: string; settlementStatus: string; deliveryOption: string;
  address: string; district: string; area: string | null; codCollectedAt: Date | null; codSettledAt: Date | null;
  shippedAt: Date | null; deliveredAt: Date | null; cancelledAt: Date | null; cancellationReason: string | null; cancellationStockReleasedAt: Date | null;
  items: Array<{ id: string; variantId: string; name: string; sku: string | null; quantity: number; unitPrice: number; lineTotal: number; attributes: object; imageUrl: string | null }>;
  reservations: unknown[]; payments: unknown[]; paymentAttempts: unknown[]; refunds: unknown[];
  product: { id: string; name: string; weightGrams: number }; customer: { id: string; name: string; phone: string; email: null } };
type Store = { order: Order; shipment: Shipment | null; stock: number; events: unknown[]; history: unknown[]; audits: unknown[];
  config: { id: string; code: string; enabled: boolean; sandbox: boolean; settings: object; credentials: object } };
let store: Store;
let queue: Promise<void>;
const tx = {
  $queryRaw: async () => [{ id: "locked", stock: store.stock }],
  order: {
    findUnique: async () => ({ productId: store.order.productId, customerId: store.order.customerId }),
    findUniqueOrThrow: async () => structuredClone(store.order),
    update: async ({ data }: { data: Partial<Order> }) => structuredClone(Object.assign(store.order, data)),
  },
  courierProviderConfiguration: { findUnique: async () => structuredClone(store.config) },
  courierShipment: {
    findFirst: async ({ where }: { where: { id?: { not: string } } }) => store.shipment && (!where.id || where.id.not !== store.shipment.id) ? structuredClone(store.shipment) : null,
    findMany: async () => store.shipment ? [structuredClone(store.shipment)] : [],
    findUnique: async ({ where }: { where: { id: string } }) => store.shipment?.id === where.id
      ? { ...structuredClone(store.shipment), order: structuredClone(store.order) } : null,
    findUniqueOrThrow: async () => structuredClone(store.shipment!),
    create: async ({ data }: { data: Partial<Shipment> & Pick<Shipment, "id" | "orderId" | "providerCode" | "status" | "codAmount" | "payload"> }) => {
      store.shipment = { cost: 0, consignmentId: null, trackingId: null, trackingUrl: null, ...data }; return structuredClone(store.shipment);
    },
    update: async ({ data }: { data: Partial<Shipment> }) => structuredClone(Object.assign(store.shipment!, data)),
  },
  ownDelivery: { findFirst: async () => null, findUnique: async () => null },
  ownDeliveryEvent: { findFirst: async () => null },
  courierOperation: { findUnique: async () => null, update: async () => null },
  returnRequest: { findFirst: async () => null },
  paymentTransaction: { findFirst: async () => null }, paymentAttempt: { findFirst: async () => null }, refund: { findFirst: async () => null },
  stockReservation: { updateMany: async () => ({ count: 0 }) },
  courierTrackingEvent: { create: async ({ data }: { data: unknown }) => { store.events.push(data); } },
  orderStatusHistory: { create: async ({ data }: { data: unknown }) => { store.history.push(data); } },
  auditLog: { create: async ({ data }: { data: unknown }) => { store.audits.push(data); } },
};

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); queue = Promise.resolve();
  store = { stock: 4, shipment: null, events: [], history: [], audits: [], config: { id: "config", code: "fixture", enabled: true, sandbox: true, settings: {}, credentials: {} },
    order: { id: "order-1", orderNumber: "ORD-1", customerId: "customer", productId: "product", variantId: "variant", quantity: 1,
      subtotal: 100, deliveryCharge: 0, discount: 0, total: 100, currency: "BDT", status: "READY_TO_SHIP", paymentMethod: "cod", paymentStatus: "COD_PENDING",
      paymentReference: null, financialStatus: "UNSETTLED", settlementStatus: "PENDING", deliveryOption: "inside_city", address: "Fixture address", district: "Rajshahi", area: null,
      codCollectedAt: null, codSettledAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null, cancellationReason: null, cancellationStockReleasedAt: null,
      items: [{ id: "item", variantId: "variant", name: "Item", sku: null, quantity: 1, unitPrice: 100, lineTotal: 100, attributes: {}, imageUrl: null }],
      reservations: [], payments: [], paymentAttempts: [], refunds: [], product: { id: "product", name: "Item", weightGrams: 500 },
      customer: { id: "customer", name: "Buyer", phone: "01700000000", email: null } } };
  mocks.credential.mockResolvedValue({ key: "fixture-secret" }); mocks.sale.mockResolvedValue(true); mocks.other.mockResolvedValue(false);
  mocks.dispatchConflict.mockResolvedValue(false); mocks.notify.mockResolvedValue(undefined);
  mocks.adjust.mockImplementation(async (_tx: unknown, input: { delta: number }) => { store.stock += input.delta; });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const prior = queue; let release!: () => void; queue = new Promise<void>((resolve) => { release = resolve; }); await prior;
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; } finally { release(); }
  });
});

describe("current-writer courier and cancellation races", () => {
  it("records cancellation during an in-flight booking, holds stock, and retains the reported booking for recovery", async () => {
    const called = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { called.resolve(); await release.promise;
      return { consignmentId: "consign-1", trackingId: "track-1", raw: {} }; });
    const booking = bookCourierShipment("order-1", "fixture", "manager").then(() => null, (error: unknown) => error);
    await called.promise;
    expect(store.shipment?.status).toBe("PENDING");
    expect(await cancelOrder("order-1", "manager", "Customer cancelled")).toEqual({ changed: true, stockReleased: false });
    expect(store.stock).toBe(4);
    release.resolve();
    expect(await booking).toEqual(expect.objectContaining({ message: expect.stringMatching(/order changed/) }));
    expect(store.shipment?.status).toBe("PENDING"); expect(store.shipment?.consignmentId).toBe("consign-1");
    expect(store.shipment?.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" } });
    await reconcileCourierBooking({ shipmentId: store.shipment!.id, merchantReference: "ORD-1", consignmentId: "consign-1", trackingId: "track-1",
      sandbox: true, evidence: "Checked original account and provider case 12345", confirmOriginalAccount: true }, "manager");
    expect(store.shipment?.status).toBe("BOOKED"); expect(store.order.status).toBe("CANCELLED"); expect(store.stock).toBe(4);
  });

  it("preserves matching late provider evidence after staff recovers an in-flight claim", async () => {
    const called = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { called.resolve(); await release.promise;
      return { consignmentId: "consign-1", trackingId: "track-1", raw: { accepted: true } }; });
    const booking = bookCourierShipment("order-1", "fixture", "manager").then(() => null, (error: unknown) => error);
    await called.promise;
    await cancelOrder("order-1", "manager", "Customer cancelled");
    await reconcileCourierBooking({ shipmentId: store.shipment!.id, merchantReference: "ORD-1", consignmentId: "consign-1", trackingId: "track-1",
      sandbox: true, evidence: "Checked original account and provider case 12345", confirmOriginalAccount: true }, "manager");
    release.resolve(); await booking;
    expect(store.shipment?.status).toBe("BOOKED");
    expect(store.shipment?.payload).toMatchObject({ landiqBooking: { state: "BOOKED" }, providerResponse: { accepted: true } });
    expect(store.shipment?.payload.conflictingProviderResult).toBeUndefined();
    expect(store.order.status).toBe("CANCELLED"); expect(store.stock).toBe(4);
  });

  it.each([true, false])("retains a late booking after a staff-recorded courier cancellation (matching: %s)", async (matching) => {
    const called = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { called.resolve(); await release.promise;
      return { consignmentId: matching ? "consign-1" : "different-consignment", trackingId: "track-1", raw: { accepted: true } }; });
    const booking = bookCourierShipment("order-1", "fixture", "manager").then(() => null, (error: unknown) => error);
    await called.promise;
    await cancelOrder("order-1", "manager", "Customer cancelled");
    await reconcileCourierBooking({ shipmentId: store.shipment!.id, merchantReference: "ORD-1", consignmentId: "consign-1", trackingId: "track-1",
      sandbox: true, evidence: "Checked original account and provider case 12345", confirmOriginalAccount: true }, "manager");
    // Model staff recording the courier cancellation while the booking call is still in flight.
    store.shipment!.status = "CANCELLED";
    release.resolve(); await booking;
    expect(store.shipment?.status).toBe(matching ? "CANCELLED" : "PENDING");
    if (matching) expect(store.shipment?.payload).toMatchObject({ landiqLateBooking: { consignmentId: "consign-1" } });
    else expect(store.shipment?.payload).toMatchObject({ conflictingProviderResult: { consignmentId: "different-consignment" } });
    expect(store.order.status).toBe("CANCELLED"); expect(store.stock).toBe(4);
  });

  it("does not overwrite existing conflicting evidence when finalization and its fallback fail", async () => {
    mocks.createShipment.mockImplementationOnce(async () => {
      store.shipment!.payload.landiqStaffRejection = null;
      store.shipment!.payload.conflictingProviderResult = { consignmentId: "prior-consignment", trackingId: "prior-tracking" };
      return { consignmentId: "late-consignment", trackingId: "late-tracking", raw: { accepted: true } };
    });
    const update = vi.spyOn(tx.courierShipment, "update").mockRejectedValueOnce(new Error("synthetic finalization failure"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(bookCourierShipment("order-1", "fixture", "manager")).rejects.toThrow(/may have been created/);
      expect(update).toHaveBeenCalledOnce();
      expect(mocks.transaction).toHaveBeenCalledTimes(3);
      await expect(mocks.transaction.mock.results[2].value).rejects.toMatchObject({
        code: "CONFLICT", status: 409, message: "Existing courier evidence requires investigation before annotating this claim",
      });
      expect(log).toHaveBeenCalledWith("Could not annotate an unresolved courier claim", expect.any(Object));
      expect(store.shipment?.status).toBe("PENDING");
      expect(store.shipment?.payload).toMatchObject({ landiqStaffRejection: null,
        conflictingProviderResult: { consignmentId: "prior-consignment", trackingId: "prior-tracking" } });
      expect(store.shipment?.consignmentId).toBeNull();
      expect(mocks.createShipment).toHaveBeenCalledOnce();
      expect(store.stock).toBe(4);
    } finally { update.mockRestore(); log.mockRestore(); }
  });

  it("does not issue duplicate bookings from simultaneous submissions", async () => {
    const called = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { called.resolve(); await release.promise;
      return { consignmentId: "consign-1", trackingId: "track-1", raw: {} }; });
    const first = bookCourierShipment("order-1", "fixture", "manager"); await called.promise;
    await expect(bookCourierShipment("order-1", "fixture", "manager")).rejects.toThrow(/courier record/);
    release.resolve(); await first;
    await bookCourierShipment("order-1", "fixture", "manager");
    expect(mocks.createShipment).toHaveBeenCalledOnce();
    expect(store.shipment?.status).toBe("BOOKED");
  });

  it("prevents a booking from starting after cancellation released undispatched stock", async () => {
    expect((await cancelOrder("order-1", "manager", "Customer cancelled")).stockReleased).toBe(true);
    await expect(bookCourierShipment("order-1", "fixture", "manager")).rejects.toThrow(/confirmed, unshipped/);
    expect(store.stock).toBe(5); expect(mocks.createShipment).not.toHaveBeenCalled();
  });
});
