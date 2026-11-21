import { beforeEach, describe, expect, it, vi } from "vitest";

// All storage is a serialized in-memory fake, with no database or courier.
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), allocated: vi.fn(), dispatchConflict: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/services/order-lock", () => ({ lockOrder: vi.fn(), hasConflictingDispatchEvidence: mocks.dispatchConflict }));
vi.mock("@/services/orders", () => ({ assertAllocatedForFulfillment: mocks.allocated }));

import { assignOwnDelivery, recordOwnDeliveryEvent } from "@/services/own-delivery";

type Order = { id: string; status: string; items: unknown[]; reservations: unknown[]; shippedAt: Date | null; deliveredAt: Date | null };
type Delivery = { id: string; orderId: string; personId: string; status: string };
type Event = { deliveryId: string; personId: string; status: string; actorId: string; note: string | null };
type Store = { order: Order; delivery: Delivery | null; active: string[]; shipment: boolean; events: Event[]; history: unknown[]; audits: unknown[] };
let store: Store;
let queue: Promise<void>;
const tx = {
  $queryRaw: async (_query: TemplateStringsArray, personId: string) => store.active.includes(personId) ? [{ id: personId }] : [],
  order: {
    findUniqueOrThrow: async () => structuredClone(store.order),
    update: async ({ data }: { data: Partial<Order> }) => Object.assign(store.order, data),
  },
  courierShipment: { findFirst: async () => store.shipment ? { id: "courier" } : null },
  ownDelivery: {
    findUnique: async () => store.delivery ? structuredClone(store.delivery) : null,
    create: async ({ data }: { data: Omit<Delivery, "id"> }) => { store.delivery = { id: "delivery-1", ...data }; return structuredClone(store.delivery); },
    update: async ({ data }: { data: Partial<Delivery> }) => structuredClone(Object.assign(store.delivery!, data)),
  },
  ownDeliveryEvent: {
    findFirst: async () => store.events.some((event) => ["DISPATCHED", "OUT_FOR_DELIVERY", "FAILED", "DELIVERED", "RETURNING", "RETURNED"].includes(event.status)) ? { id: "event" } : null,
    create: async ({ data }: { data: Event }) => { store.events.push(data); },
  },
  orderStatusHistory: { create: async ({ data }: { data: unknown }) => { store.history.push(data); } },
  stockReservation: { updateMany: async () => ({ count: 0 }) },
  auditLog: { create: async ({ data }: { data: unknown }) => { store.audits.push(data); } },
};

beforeEach(() => {
  vi.clearAllMocks(); queue = Promise.resolve();
  store = { order: { id: "order-1", status: "READY_TO_SHIP", items: [], reservations: [], shippedAt: null, deliveredAt: null },
    delivery: null, active: ["driver-1", "driver-2"], shipment: false, events: [], history: [], audits: [] };
  mocks.allocated.mockResolvedValue(undefined); mocks.dispatchConflict.mockResolvedValue(false);
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const prior = queue; let release!: () => void; queue = new Promise<void>((resolve) => { release = resolve; }); await prior;
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; } finally { release(); }
  });
});

describe("shop-owned delivery history", () => {
  it("assigns active staff idempotently and requires a matching snapshot to reassign", async () => {
    const input = { orderId: "order-1", personId: "driver-1" };
    const [first, duplicate] = await Promise.all([assignOwnDelivery(input, "manager"), assignOwnDelivery(input, "manager")]);
    expect(first.id).toBe(duplicate.id); expect(store.events).toHaveLength(1);
    await expect(assignOwnDelivery({ orderId: "order-1", personId: "driver-2" }, "manager")).rejects.toThrow(/changed/);
    await assignOwnDelivery({ orderId: "order-1", personId: "driver-2", expectedPersonId: "driver-1" }, "manager");
    expect(store.delivery?.personId).toBe("driver-2");
    expect(store.events.map((event) => event.personId)).toEqual(["driver-1", "driver-2"]);
  });

  it("rejects inactive staff, an existing courier, or missing allocation", async () => {
    await expect(assignOwnDelivery({ orderId: "order-1", personId: "inactive" }, "manager")).rejects.toThrow(/active staff/);
    store.shipment = true;
    await expect(assignOwnDelivery({ orderId: "order-1", personId: "driver-1" }, "manager")).rejects.toThrow(/courier record/);
    store.shipment = false; mocks.allocated.mockRejectedValueOnce(new Error("allocation unavailable"));
    await expect(assignOwnDelivery({ orderId: "order-1", personId: "driver-1" }, "manager")).rejects.toThrow(/allocation/);
    expect(store.delivery).toBeNull();
  });

  it("checks staff again at dispatch and cannot dispatch after cancellation", async () => {
    await assignOwnDelivery({ orderId: "order-1", personId: "driver-1" }, "manager");
    store.active = [];
    await expect(recordOwnDeliveryEvent({ orderId: "order-1", status: "DISPATCHED" }, "manager")).rejects.toThrow(/inactive/);
    store.active = ["driver-1"]; store.order.status = "CANCELLED";
    await expect(recordOwnDeliveryEvent({ orderId: "order-1", status: "DISPATCHED" }, "manager")).rejects.toThrow(/closed/);
    expect(store.delivery?.status).toBe("ASSIGNED");
  });

  it("records dispatch, failure and physical return without reopening a cancelled order", async () => {
    await assignOwnDelivery({ orderId: "order-1", personId: "driver-1" }, "manager");
    await recordOwnDeliveryEvent({ orderId: "order-1", status: "DISPATCHED" }, "manager");
    expect(store.order.status).toBe("SHIPPED"); expect(store.order.shippedAt).toBeInstanceOf(Date);
    store.order.status = "CANCELLED";
    await recordOwnDeliveryEvent({ orderId: "order-1", status: "OUT_FOR_DELIVERY" }, "manager");
    await recordOwnDeliveryEvent({ orderId: "order-1", status: "FAILED", note: "No answer" }, "manager");
    await recordOwnDeliveryEvent({ orderId: "order-1", status: "RETURNING" }, "manager");
    await recordOwnDeliveryEvent({ orderId: "order-1", status: "RETURNED" }, "manager");
    await recordOwnDeliveryEvent({ orderId: "order-1", status: "RETURNED" }, "manager");
    expect(store.order.status).toBe("CANCELLED");
    expect(store.events.map((event) => event.status)).toEqual(["ASSIGNED", "DISPATCHED", "OUT_FOR_DELIVERY", "FAILED", "RETURNING", "RETURNED"]);
    expect(store.history).toHaveLength(1); // Only dispatch changed the commercial status.
  });

  it("permits unassignment before dispatch while preserving the event history", async () => {
    await assignOwnDelivery({ orderId: "order-1", personId: "driver-1" }, "manager");
    await recordOwnDeliveryEvent({ orderId: "order-1", status: "CANCELLED" }, "manager");
    await assignOwnDelivery({ orderId: "order-1", personId: "driver-2", expectedPersonId: "driver-1" }, "manager");
    expect(store.events.map((event) => event.status)).toEqual(["ASSIGNED", "CANCELLED", "ASSIGNED"]);
    expect(store.delivery?.personId).toBe("driver-2");
  });

  it("refuses to unassign when historical dispatch, a courier, or a closed order conflicts", async () => {
    await assignOwnDelivery({ orderId: "order-1", personId: "driver-1" }, "manager");
    mocks.dispatchConflict.mockResolvedValue(true);
    await expect(recordOwnDeliveryEvent({ orderId: "order-1", status: "CANCELLED" }, "manager")).rejects.toThrow(/requires review/);
    mocks.dispatchConflict.mockResolvedValue(false); store.shipment = true;
    await expect(recordOwnDeliveryEvent({ orderId: "order-1", status: "CANCELLED" }, "manager")).rejects.toThrow(/requires review/);
    store.shipment = false; store.order.status = "CANCELLED";
    await expect(recordOwnDeliveryEvent({ orderId: "order-1", status: "CANCELLED" }, "manager")).rejects.toThrow(/requires review/);
    expect(store.delivery?.status).toBe("ASSIGNED");
    expect(store.events.map((event) => event.status)).toEqual(["ASSIGNED"]);
  });
});
