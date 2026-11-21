import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourierProviderConfiguration } from "@prisma/client";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), tracking: vi.fn(), credential: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  courierShipment: { findUniqueOrThrow: async () => ({ ...structuredClone(store.shipment), order: { orderNumber: "ORD-1" } }) },
  courierProviderConfiguration: { findUnique: async () => structuredClone(store.config) },
} }));
vi.mock("@/lib/settings", () => ({ getCourierCredentialFromSnapshot: mocks.credential }));
vi.mock("@/lib/couriers/registry", () => ({ getCourierProvider: () => ({ getTracking: mocks.tracking }) }));
vi.mock("@/lib/payments/registry", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notify: vi.fn(), notifyOwners: vi.fn() }));
vi.mock("@/lib/marketing", () => ({ sendServerPurchaseEvent: vi.fn() }));
vi.mock("@/services/order-lock", () => ({ lockOrder: vi.fn() }));

import { courierConfigurationMac, syncCourierTracking } from "@/services/orders";

type Config = CourierProviderConfiguration;
type Shipment = { id: string; orderId: string; providerCode: string; status: string; trackingId: string; consignmentId: string;
  payload: { landiqBooking: { version: number; state: string; sandbox: boolean; merchantReference: string; orderStatusAtClaim: string;
    requestFingerprint: string; configurationMac: string } } };
let store: { config: Config; shipment: Shipment; events: Array<Record<string, unknown>>; audits: unknown[] };
const credentials = { apiKey: "fixture-secret" };
const tx = {
  $queryRaw: async () => [{ id: "config" }],
  courierShipment: { findUniqueOrThrow: async () => structuredClone(store.shipment) },
  courierProviderConfiguration: { findUnique: async () => structuredClone(store.config) },
  courierTrackingEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { store.events.push(data); } },
  auditLog: { create: async ({ data }: { data: unknown }) => { store.audits.push(data); } },
};

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("FIXTURE_API_BASE", "");
  const config: Config = { id: "config", code: "fixture", name: "Fixture", enabled: true, sandbox: true,
    credentials: {}, settings: {}, visible: true, isDefault: false, status: "configured", lastTestedAt: null,
    lastError: null, sortOrder: 0, updatedAt: new Date("2026-01-01T00:00:00Z") };
  store = { config, events: [], audits: [], shipment: { id: "shipment-1", orderId: "order-1", providerCode: "fixture", status: "BOOKED",
    trackingId: "track-1", consignmentId: "consign-1", payload: { landiqBooking: { version: 4, state: "BOOKED", sandbox: true,
      merchantReference: "ORD-1", orderStatusAtClaim: "READY_TO_SHIP", requestFingerprint: "a".repeat(64),
      configurationMac: courierConfigurationMac(config, credentials, "") } } } };
  mocks.credential.mockResolvedValue(credentials);
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

afterEach(() => { vi.unstubAllEnvs(); });

describe("safe courier tracking", () => {
  it("records recognized tracking without updating order or inventory", async () => {
    mocks.tracking.mockResolvedValue({ status: "out for delivery", raw: {} });
    expect(await syncCourierTracking("shipment-1", "manager")).toEqual({ status: "OUT_FOR_DELIVERY" });
    expect(store.events[0]).toMatchObject({ status: "OUT_FOR_DELIVERY", source: "API", raw: { recognized: true } });
    expect(store.shipment.status).toBe("BOOKED");
  });

  it("does not persist provider echoes or cast unknown strings to a database enum", async () => {
    mocks.tracking.mockResolvedValue({ status: "unknown fixture-secret", description: "fixture-secret", raw: { token: "fixture-secret" } });
    expect(await syncCourierTracking("shipment-1", "manager")).toEqual({ status: "UNRECOGNIZED" });
    expect(store.events[0]).toMatchObject({ status: "BOOKED", raw: { recognized: false } });
    expect(JSON.stringify(store.events)).not.toContain("fixture-secret");
  });

  it("blocks tracking with rotated account configuration before a provider call", async () => {
    store.config.settings = { changed: true };
    await expect(syncCourierTracking("shipment-1", "manager")).rejects.toThrow(/account or endpoint changed/);
    expect(mocks.tracking).not.toHaveBeenCalled(); expect(store.events).toHaveLength(0);
  });

  it("rechecks the original account after a delayed response before saving it", async () => {
    mocks.tracking.mockImplementationOnce(async () => { store.config.settings = { changed: true }; return { status: "DELIVERED", raw: {} }; });
    await expect(syncCourierTracking("shipment-1", "manager")).rejects.toThrow(/details changed/);
    expect(store.events).toHaveLength(0);
  });
});
