import { beforeEach, describe, expect, it, vi } from "vitest";

// Serialized, rollback-capable in-memory transactions. No database or provider
// is contacted; these tests do not establish PostgreSQL locking behavior.
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), sale: vi.fn(), otherMovement: vi.fn(), dispatchConflict: vi.fn(),
  adjust: vi.fn(), notify: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify, notifyOwners: vi.fn() }));
vi.mock("@/lib/marketing", () => ({ sendServerPurchaseEvent: vi.fn() }));
vi.mock("@/lib/settings", () => ({}));
vi.mock("@/lib/payments/registry", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/couriers/registry", () => ({ getCourierProvider: vi.fn() }));
vi.mock("@/services/inventory", () => ({ adjustStock: mocks.adjust, hasRecordedOrderSale: mocks.sale, hasOtherOrderStockMovement: mocks.otherMovement }));
vi.mock("@/services/order-lock", () => ({ lockOrder: vi.fn(), hasConflictingDispatchEvidence: mocks.dispatchConflict,
  assertNoConflictingDispatchEvidence: vi.fn(), assertNoUnresolvedCourier: vi.fn(), hasUnresolvedCourier: vi.fn() }));

import { cancelOrder } from "@/services/orders";

type Payment = { provider: string; reference: string; status: string; amount: number; currency: string; verifiedAt: Date | null };
type Order = {
  id: string; orderNumber: string; customerId: string; productId: string; status: string; paymentMethod: string;
  paymentStatus: string; paymentReference: string | null; financialStatus: string; settlementStatus: string;
  codCollectedAt: Date | null; codSettledAt: Date | null; shippedAt: Date | null; deliveredAt: Date | null;
  cancelledAt: Date | null; cancellationReason: string | null; cancellationStockReleasedAt: Date | null; internalNote: string;
  total: number; currency: string; items: Array<{ id: string; variantId: string; quantity: number }>;
  payments: Payment[]; paymentAttempts: Array<{ provider: string; status: string }>; reservations: Array<{ variantId: string; quantity: number; releasedAt: Date | null }>;
  refunds: Array<{ status: string }>;
};
type Delivery = { id: string; personId: string; status: string };
type Store = { order: Order; stock: number; shipment: boolean; delivery: Delivery | null; deliveryHistory: string[];
  movements: Array<{ delta: number; type: string }>; history: Array<{ fromStatus: string; toStatus: string }>; audits: unknown[] };
let store: Store;
let queue: Promise<void>;

const tx = {
  $queryRaw: async () => [{ stock: store.stock }],
  order: {
    findUniqueOrThrow: async () => structuredClone(store.order),
    update: async ({ data }: { data: Partial<Order> }) => Object.assign(store.order, data),
  },
  courierShipment: { findFirst: async () => store.shipment ? { id: "shipment" } : null },
  ownDelivery: {
    findUnique: async () => store.delivery ? structuredClone(store.delivery) : null,
    update: async ({ data }: { data: Partial<Delivery> }) => Object.assign(store.delivery!, data),
  },
  ownDeliveryEvent: {
    findFirst: async () => store.deliveryHistory.some((status) => status === "DISPATCHED") ? { id: "event" } : null,
    create: async ({ data }: { data: { status: string } }) => { store.deliveryHistory.push(data.status); },
  },
  paymentTransaction: { findFirst: async () => null },
  paymentAttempt: { findFirst: async () => null },
  refund: { findFirst: async () => null },
  stockReservation: { updateMany: async () => { for (const row of store.order.reservations) row.releasedAt ??= new Date(); } },
  orderStatusHistory: { create: async ({ data }: { data: { fromStatus: string; toStatus: string } }) => { store.history.push(data); } },
  auditLog: { create: async ({ data }: { data: unknown }) => { store.audits.push(data); } },
};

beforeEach(() => {
  vi.clearAllMocks();
  queue = Promise.resolve();
  store = { stock: 3, shipment: false, delivery: null, deliveryHistory: [], movements: [], history: [], audits: [], order: {
    id: "order-1", orderNumber: "ORD-1", customerId: "customer", productId: "product", status: "READY_TO_SHIP",
    paymentMethod: "cod", paymentStatus: "COD_PENDING", paymentReference: null, financialStatus: "UNSETTLED",
    settlementStatus: "PENDING", codCollectedAt: null, codSettledAt: null, shippedAt: null, deliveredAt: null,
    cancelledAt: null, cancellationReason: null, cancellationStockReleasedAt: null, internalNote: "Keep this note",
    total: 100, currency: "BDT", items: [{ id: "item", variantId: "variant", quantity: 2 }],
    payments: [], paymentAttempts: [], reservations: [], refunds: [],
  } };
  mocks.sale.mockResolvedValue(true);
  mocks.otherMovement.mockResolvedValue(false);
  mocks.dispatchConflict.mockResolvedValue(false);
  mocks.notify.mockResolvedValue(undefined);
  mocks.adjust.mockImplementation(async (_client: unknown, input: { delta: number; type: string }) => {
    store.stock += input.delta; store.movements.push({ delta: input.delta, type: input.type });
  });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const prior = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; } finally { release(); }
  });
});

describe("cancellation separates commercial status from stock and delivery", () => {
  it("serializes simultaneous cancellation and releases verified undispatched stock once", async () => {
    store.delivery = { id: "delivery", personId: "driver", status: "ASSIGNED" };
    const results = await Promise.all([cancelOrder("order-1", "staff", "Customer request"), cancelOrder("order-1", "staff", "Customer request")]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(store.order.status).toBe("CANCELLED");
    expect(store.order.cancellationReason).toBe("Customer request");
    expect(store.order.internalNote).toBe("Keep this note");
    expect(store.order.cancellationStockReleasedAt).toBeInstanceOf(Date);
    expect(store.stock).toBe(5);
    expect(store.movements).toEqual([{ delta: 2, type: "CANCELLATION" }]);
    expect(store.history).toHaveLength(1);
    expect(store.delivery?.status).toBe("CANCELLED");
    expect(store.deliveryHistory).toEqual(["CANCELLED"]);
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it.each(["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"])("records %s cancellation without returning stock", async (status) => {
    store.order.status = status;
    store.order.shippedAt = new Date();
    const result = await cancelOrder("order-1", "staff", "Customer request");
    expect(result).toEqual({ changed: true, stockReleased: false });
    expect(store.order.status).toBe("CANCELLED");
    expect(store.stock).toBe(3);
    expect(store.movements).toEqual([]);
  });

  it("records cancellation while a courier claim is unresolved and never releases stock", async () => {
    store.shipment = true;
    await cancelOrder("order-1", "staff", "Courier might have the parcel");
    await cancelOrder("order-1", "staff", "Retry");
    expect(store.history).toHaveLength(1);
    expect(store.order.status).toBe("CANCELLED");
    expect(store.stock).toBe(3);
    expect(mocks.adjust).not.toHaveBeenCalled();
  });

  it("records cancellation but retains stock for uncertain financial or ledger evidence", async () => {
    store.order.paymentMethod = "online";
    store.order.paymentStatus = "PENDING";
    store.order.paymentAttempts = [{ provider: "online", status: "INITIALIZATION_UNKNOWN" }];
    store.order.reservations = [{ variantId: "variant", quantity: 2, releasedAt: null }];
    expect(await cancelOrder("order-1", "staff", "Payment uncertain")).toEqual({ changed: true, stockReleased: false });
    expect(store.order.reservations[0].releasedAt).toBeNull();
    expect(store.stock).toBe(3);
  });

  it("can release verified, paid but undispatched stock while leaving payment status intact", async () => {
    store.order.paymentMethod = "online";
    store.order.paymentStatus = "PAID";
    store.order.paymentReference = "pay-1";
    store.order.financialStatus = "PARTIALLY_SETTLED";
    store.order.reservations = [{ variantId: "variant", quantity: 2, releasedAt: new Date() }];
    store.order.payments = [{ provider: "online", reference: "pay-1", status: "PAID", amount: 100, currency: "BDT", verifiedAt: new Date() }];
    expect(await cancelOrder("order-1", "staff", "Paid cancellation")).toEqual({ changed: true, stockReleased: true });
    expect(store.order.paymentStatus).toBe("PAID");
    expect(store.stock).toBe(5);
  });

  it.each(["unrecorded sale", "previous movement", "conflicting dispatch", "full stock balance"])("does not release with %s", async (condition) => {
    if (condition === "unrecorded sale") mocks.sale.mockResolvedValue(false);
    if (condition === "previous movement") mocks.otherMovement.mockResolvedValue(true);
    if (condition === "conflicting dispatch") mocks.dispatchConflict.mockResolvedValue(true);
    if (condition === "full stock balance") store.stock = 2_147_483_647;
    const initial = store.stock;
    const result = await cancelOrder("order-1", "staff", "Requires review");
    expect(result.stockReleased).toBe(false);
    expect(store.order.status).toBe("CANCELLED");
    expect(store.stock).toBe(initial);
  });

  it("does not treat an old cancelled delivery with dispatch history as undispatched", async () => {
    store.delivery = { id: "delivery", personId: "driver", status: "CANCELLED" };
    store.deliveryHistory = ["DISPATCHED", "CANCELLED"];
    expect((await cancelOrder("order-1", "staff", "Conflicting history")).stockReleased).toBe(false);
    expect(store.stock).toBe(3);
  });

  it("records cancellation without falsely closing an assigned delivery with prior dispatch evidence", async () => {
    store.delivery = { id: "delivery", personId: "driver", status: "ASSIGNED" };
    store.deliveryHistory = ["DISPATCHED"];
    mocks.dispatchConflict.mockResolvedValue(true);
    const result = await cancelOrder("order-1", "staff", "Conflicting delivery history");
    expect(result).toEqual({ changed: true, stockReleased: false });
    expect(store.order.status).toBe("CANCELLED");
    expect(store.delivery.status).toBe("ASSIGNED");
    expect(store.deliveryHistory).toEqual(["DISPATCHED"]);
    expect(store.audits).toContainEqual(expect.objectContaining({ after: expect.objectContaining({ ownDeliveryRequiresReview: true }) }));
    expect(store.stock).toBe(3);
  });

  it("keeps an inconsistent assignment for review if a third-party shipment exists", async () => {
    store.delivery = { id: "delivery", personId: "driver", status: "ASSIGNED" };
    store.shipment = true;
    await cancelOrder("order-1", "staff", "Conflicting couriers");
    expect(store.order.status).toBe("CANCELLED");
    expect(store.delivery.status).toBe("ASSIGNED");
    expect(store.deliveryHistory).toEqual([]);
    expect(store.stock).toBe(3);
  });
});
