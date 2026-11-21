import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulated serialized transactions; this verifies the in-transaction recheck,
// not PostgreSQL's real lock scheduling or provider behavior.
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), preflight: vi.fn(), adjust: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  product: { findUnique: async () => structuredClone(product) },
  order: { findFirst: mocks.preflight, count: async () => 0 },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/settings", () => ({ assertPaymentMethodAvailable: async () => ({ name: "COD", sandbox: true }),
  calculateDeliveryCharge: async () => ({ charge: 0 }), getBusinessSettings: async () => ({ currency: "BDT" }) }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify, notifyOwners: mocks.notify }));
vi.mock("@/lib/marketing", () => ({ sendServerPurchaseEvent: vi.fn() }));
vi.mock("@/lib/payments/registry", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/couriers/registry", () => ({ getCourierProvider: vi.fn() }));
vi.mock("@/services/inventory", () => ({ adjustStock: mocks.adjust }));

import { placeOrder } from "@/services/orders";

const product = { id: "product-1", name: "Fixture", sku: null, status: "PUBLISHED", regularPrice: 100, salePrice: null,
  landingPage: null, images: [], variants: ["variant-1", "variant-2"].map((id) => ({ id, name: id, sku: null,
    price: null, stock: 10, imageUrl: null, isActive: true, attributes: [] })) };
type Created = { id: string; orderNumber: string; customerId: string; productId: string; total: number; currency: string; paymentMethod: string };
let orders: Created[];
let queue: Promise<void>;
const statements: string[] = [];
const tx = {
  $queryRaw: async (sql: TemplateStringsArray) => { statements.push(sql.join("?")); return [{ id: "locked" }]; },
  product: { findUnique: async () => structuredClone(product) },
  customer: { upsert: async ({ where }: { where: { phone: string } }) => ({ id: `customer-${where.phone}` }) },
  order: {
    findFirst: async ({ where }: { where: { customerId: string; productId: string } }) =>
      orders.find((order) => order.customerId === where.customerId && order.productId === where.productId) ?? null,
    create: async ({ data }: { data: Omit<Created, "id"> }) => { const created = { ...data, id: `order-${orders.length + 1}` }; orders.push(created); return created; },
  },
  auditLog: { create: async () => ({}) },
};
function checkout(variantId: string, phone = "01700000000") {
  return { productId: "product-1", variantId, quantity: 1, paymentMethod: "cod", deliveryOption: "inside_city" as const,
    customer: { name: "Fixture Buyer", phone, address: "123 Fixture Street", district: "Rajshahi" } };
}

beforeEach(() => {
  vi.clearAllMocks(); orders = []; statements.length = 0; queue = Promise.resolve();
  mocks.preflight.mockResolvedValue(null); mocks.adjust.mockResolvedValue(undefined); mocks.notify.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const prior = queue; let release!: () => void; queue = new Promise<void>((resolve) => { release = resolve; }); await prior;
    const snapshot = structuredClone(orders);
    try { return await callback(tx); } catch (error) { orders = snapshot; throw error; } finally { release(); }
  });
});

describe("checkout duplicate recheck", () => {
  it("rejects a concurrent duplicate for different variants after locking the same customer", async () => {
    const result = await Promise.allSettled([placeOrder(checkout("variant-1")), placeOrder(checkout("variant-2"))]);
    expect(result.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((row) => row.status === "rejected")).toHaveLength(1);
    expect(orders).toHaveLength(1); expect(mocks.adjust).toHaveBeenCalledOnce();
    expect(statements.filter((statement) => statement.includes('FROM "Customer"') && statement.includes("FOR UPDATE"))).toHaveLength(2);
  });

  it("allows different customers to order the same product", async () => {
    const result = await Promise.allSettled([placeOrder(checkout("variant-1", "01700000000")), placeOrder(checkout("variant-2", "01800000000"))]);
    expect(result.every((row) => row.status === "fulfilled")).toBe(true);
    expect(orders).toHaveLength(2); expect(mocks.adjust).toHaveBeenCalledTimes(2);
  });
});
