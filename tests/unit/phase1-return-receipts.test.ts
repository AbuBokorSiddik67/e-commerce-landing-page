import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory serializable transactions with rollback. These deliberately do not
// contact PostgreSQL or a courier and are not a substitute for database tests.
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), sale: vi.fn(), adjust: vi.fn(), damaged: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  returnRequest: { findUnique: (...args: unknown[]) => pointers.request(...args) },
  returnReceipt: { findUnique: (...args: unknown[]) => pointers.receipt(...args) },
} }));
vi.mock("@/lib/notifications", () => ({ notifyOwners: vi.fn() }));
vi.mock("@/services/inventory", () => ({ adjustStock: mocks.adjust, receiveDamagedStock: mocks.damaged, hasRecordedOrderSale: mocks.sale }));
vi.mock("@/services/order-lock", () => ({ lockOrder: vi.fn() }));

import { createReturnRequest, inspectReturnReceipt, receiveReturnItems, updateReturnStatus } from "@/services/returns";

type Item = { id: string; variantId: string; quantity: number; name: string };
type Order = { id: string; orderNumber: string; productId: string; status: string; items: Item[]; refunds: Array<{ amount: number; status: string }> };
type RequestRow = { id: string; orderId: string; productId: string; reason: string; status: string; restock: boolean;
  inspectionNote: string | null; resolvedAt: Date | null };
type Receipt = { id: string; orderId: string; returnRequestId: string; orderItemId: string; receivedQuantity: number;
  receivedById: string; sellableQuantity: number | null; damagedQuantity: number | null; inspectionNote: string | null;
  inspectedById: string | null; inspectedAt: Date | null };
type Movement = { productId: string; variantId: string; quantity: number; type: string; bucket: string; returnReceiptId: string | null; reference: string };
type Store = { order: Order; requests: RequestRow[]; receipts: Receipt[]; movements: Movement[]; sellable: number; damaged: number;
  audits: unknown[]; history: unknown[]; sequence: number };
let store: Store;
let queue: Promise<void>;

const pointers = {
  request: async (...args: unknown[]) => {
    const { where } = args[0] as { where: { id: string } };
    const row = store.requests.find((request) => request.id === where.id);
    return row ? { orderId: row.orderId } : null;
  },
  receipt: async (...args: unknown[]) => {
    const { where } = args[0] as { where: { id: string } };
    const row = store.receipts.find((receipt) => receipt.id === where.id);
    return row ? { orderId: row.orderId } : null;
  },
};

const tx = {
  $queryRaw: async () => [],
  order: {
    findUniqueOrThrow: async () => structuredClone(store.order),
    update: async ({ data }: { data: Partial<Order> }) => Object.assign(store.order, data),
  },
  returnRequest: {
    findFirst: async () => store.requests.find((request) => !["REJECTED", "COMPLETED"].includes(request.status)) ?? null,
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = store.requests.find((request) => request.id === where.id);
      return row ? { ...structuredClone(row), order: structuredClone(store.order), receipts: structuredClone(store.receipts.filter((r) => r.returnRequestId === row.id)) } : null;
    },
    create: async ({ data }: { data: { orderId: string; productId: string; reason: string } }) => {
      const row: RequestRow = { id: `request-${++store.sequence}`, orderId: data.orderId, productId: data.productId,
        reason: data.reason, status: "REQUESTED", restock: true, inspectionNote: null, resolvedAt: null };
      store.requests.push(row); return structuredClone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<RequestRow> }) => {
      const row = store.requests.find((request) => request.id === where.id)!;
      return structuredClone(Object.assign(row, data));
    },
  },
  returnReceipt: {
    findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
      const row = store.receipts.find((receipt) => receipt.id === where.id);
      if (!row) return null;
      if (!include) return structuredClone(row);
      return { ...structuredClone(row), order: structuredClone(store.order),
        orderItem: structuredClone(store.order.items.find((item) => item.id === row.orderItemId)!),
        returnRequest: structuredClone(store.requests.find((request) => request.id === row.returnRequestId)!) };
    },
    findMany: async ({ where, include }: { where: { orderId: string; orderItemId?: string }; include?: unknown }) =>
      store.receipts.filter((receipt) => receipt.orderId === where.orderId && (!where.orderItemId || receipt.orderItemId === where.orderItemId))
        .map((receipt) => include ? { ...structuredClone(receipt), returnRequest: structuredClone(store.requests.find((r) => r.id === receipt.returnRequestId)!) } : structuredClone(receipt)),
    create: async ({ data }: { data: Pick<Receipt, "id" | "orderId" | "returnRequestId" | "orderItemId" | "receivedQuantity" | "receivedById"> }) => {
      const row: Receipt = { ...data, sellableQuantity: null, damagedQuantity: null, inspectionNote: null, inspectedAt: null, inspectedById: null };
      store.receipts.push(row); return structuredClone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Receipt> }) => {
      const row = store.receipts.find((receipt) => receipt.id === where.id)!;
      return structuredClone(Object.assign(row, data));
    },
  },
  stockMovement: { findMany: async () => structuredClone(store.movements) },
  auditLog: { create: async ({ data }: { data: unknown }) => { store.audits.push(data); } },
  orderStatusHistory: { create: async ({ data }: { data: unknown }) => { store.history.push(data); } },
};

const firstKey = "40000000-0000-4000-8000-000000000001";
const secondKey = "40000000-0000-4000-8000-000000000002";
const receiptInput = (quantity: number, idempotencyKey = firstKey, returnRequestId = "return-1") =>
  ({ returnRequestId, orderItemId: "item-1", quantity, idempotencyKey });

beforeEach(() => {
  vi.clearAllMocks(); queue = Promise.resolve();
  store = { sellable: 4, damaged: 0, movements: [], receipts: [], audits: [], history: [], sequence: 1,
    order: { id: "order-1", orderNumber: "ORD-1", productId: "product-1", status: "SHIPPED", refunds: [],
      items: [{ id: "item-1", variantId: "variant-1", quantity: 4, name: "Fixture item" }] },
    requests: [{ id: "return-1", orderId: "order-1", productId: "product-1", reason: "Return", status: "APPROVED",
      restock: true, inspectionNote: null, resolvedAt: null }] };
  mocks.sale.mockResolvedValue(true);
  mocks.adjust.mockImplementation(async (_tx: unknown, input: { variantId: string; delta: number; type: string; reference: string; returnReceiptId: string }) => {
    store.sellable += input.delta;
    store.movements.push({ productId: "product-1", variantId: input.variantId, quantity: input.delta, type: input.type,
      bucket: "SELLABLE", returnReceiptId: input.returnReceiptId, reference: input.reference });
  });
  mocks.damaged.mockImplementation(async (_tx: unknown, input: { variantId: string; quantity: number; reference: string; returnReceiptId: string }) => {
    store.damaged += input.quantity;
    store.movements.push({ productId: "product-1", variantId: input.variantId, quantity: input.quantity, type: "RETURN",
      bucket: "DAMAGED", returnReceiptId: input.returnReceiptId, reference: input.reference });
  });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const prior = queue; let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; }); await prior;
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; } finally { release(); }
  });
});

describe("partial physical returns", () => {
  it("receives without stock, then atomically splits sellable and damaged stock once", async () => {
    const receipt = await receiveReturnItems(receiptInput(2), "receiver");
    expect(store.sellable).toBe(4); expect(store.damaged).toBe(0); expect(store.movements).toHaveLength(0);
    expect((await receiveReturnItems(receiptInput(2), "receiver")).id).toBe(receipt.id);
    await expect(receiveReturnItems(receiptInput(1), "receiver")).rejects.toThrow(/different details/);
    const inspection = { receiptId: receipt.id, sellableQuantity: 1, damagedQuantity: 1, note: "One torn" };
    await inspectReturnReceipt(inspection, "inspector");
    await inspectReturnReceipt(inspection, "inspector");
    expect(store.sellable).toBe(5); expect(store.damaged).toBe(1);
    expect(store.movements.map((m) => [m.bucket, m.quantity])).toEqual([["SELLABLE", 1], ["DAMAGED", 1]]);
    await expect(inspectReturnReceipt({ ...inspection, sellableQuantity: 2, damagedQuantity: 0 }, "inspector")).rejects.toThrow(/different details/);
    expect(store.movements).toHaveLength(2);
  });

  it("serializes concurrent receipts and rejects over-return across keys", async () => {
    const results = await Promise.allSettled([
      receiveReturnItems(receiptInput(3, firstKey), "one"), receiveReturnItems(receiptInput(3, secondKey), "two"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(store.receipts).toHaveLength(1);
    expect(store.receipts[0].receivedQuantity).toBe(3);
    expect(store.movements).toHaveLength(0);
  });

  it("does not post a split that differs from the physically received quantity", async () => {
    const receipt = await receiveReturnItems(receiptInput(2), "receiver");
    await expect(inspectReturnReceipt({ receiptId: receipt.id, sellableQuantity: 2, damagedQuantity: 1 }, "inspector")).rejects.toThrow(/must equal/);
    expect(store.receipts[0].inspectedAt).toBeNull(); expect(store.sellable).toBe(4); expect(store.damaged).toBe(0);
  });

  it("rolls the whole inspection back if the damaged-balance write fails", async () => {
    const receipt = await receiveReturnItems(receiptInput(2), "receiver");
    mocks.damaged.mockRejectedValueOnce(new Error("synthetic write failure"));
    await expect(inspectReturnReceipt({ receiptId: receipt.id, sellableQuantity: 1, damagedQuantity: 1 }, "inspector")).rejects.toThrow(/synthetic/);
    expect(store.receipts[0].inspectedAt).toBeNull(); expect(store.sellable).toBe(4); expect(store.damaged).toBe(0);
    expect(store.movements).toHaveLength(0);
  });

  it("records physical custody but refuses to re-credit ambiguous legacy movements", async () => {
    store.movements.push({ productId: "product-1", variantId: "variant-1", quantity: 4, type: "CANCELLATION",
      bucket: "SELLABLE", returnReceiptId: null, reference: "order-1" });
    const receipt = await receiveReturnItems(receiptInput(1), "receiver");
    await expect(inspectReturnReceipt({ receiptId: receipt.id, sellableQuantity: 1, damagedQuantity: 0 }, "inspector")).rejects.toThrow(/not backed/);
    expect(store.sellable).toBe(4); expect(store.receipts[0].inspectedAt).toBeNull();
  });

  it("detects an incomplete ledger even on an otherwise identical inspection retry", async () => {
    const receipt = await receiveReturnItems(receiptInput(2), "receiver");
    const split = { receiptId: receipt.id, sellableQuantity: 1, damagedQuantity: 1 };
    await inspectReturnReceipt(split, "inspector");
    store.movements = store.movements.filter((movement) => movement.bucket !== "DAMAGED");
    await expect(inspectReturnReceipt(split, "inspector")).rejects.toThrow(/incomplete or duplicated/);
  });

  it("requires receipts before status changes and permits a second partial return", async () => {
    await expect(updateReturnStatus("return-1", "INSPECTED", "staff")).rejects.toThrow(/Record and inspect/);
    const first = await receiveReturnItems(receiptInput(2), "receiver");
    await inspectReturnReceipt({ receiptId: first.id, sellableQuantity: 2, damagedQuantity: 0 }, "inspector");
    await updateReturnStatus("return-1", "INSPECTED", "staff");
    await updateReturnStatus("return-1", "COMPLETED", "staff");
    expect(store.order.status).toBe("SHIPPED");
    const request = await createReturnRequest({ orderId: "order-1", reason: "Remaining items" }, "staff");
    await updateReturnStatus(request.id, "APPROVED", "staff");
    const second = await receiveReturnItems(receiptInput(2, secondKey, request.id), "receiver");
    await inspectReturnReceipt({ receiptId: second.id, sellableQuantity: 1, damagedQuantity: 1 }, "inspector");
    await updateReturnStatus(request.id, "INSPECTED", "staff");
    await updateReturnStatus(request.id, "COMPLETED", "staff");
    expect(store.order.status).toBe("RETURNED");
    expect(store.sellable).toBe(7); expect(store.damaged).toBe(1);
    expect(store.history).toHaveLength(1);
  });

  it("keeps the commercial order cancelled after all goods are physically returned", async () => {
    store.order.status = "CANCELLED";
    const receipt = await receiveReturnItems(receiptInput(4), "receiver");
    await inspectReturnReceipt({ receiptId: receipt.id, sellableQuantity: 0, damagedQuantity: 4 }, "inspector");
    await updateReturnStatus("return-1", "INSPECTED", "staff");
    await updateReturnStatus("return-1", "COMPLETED", "staff");
    expect(store.order.status).toBe("CANCELLED"); expect(store.damaged).toBe(4); expect(store.sellable).toBe(4);
  });
});
