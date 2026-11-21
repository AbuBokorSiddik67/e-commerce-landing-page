import { beforeEach, describe, expect, it, vi } from "vitest";

// These tests never create an order or connect to a real database.
const mocks = vi.hoisted(() => ({
  findProduct: vi.fn(), findOrder: vi.fn(), countOrders: vi.fn(), findCreatedOrder: vi.fn(),
  transaction: vi.fn(), customerUpsert: vi.fn(), createOrder: vi.fn(), auditCreate: vi.fn(),
  adjustStock: vi.fn(), notify: vi.fn(), notifyOwners: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  product: { findUnique: mocks.findProduct },
  order: { findFirst: mocks.findOrder, count: mocks.countOrders, findUniqueOrThrow: mocks.findCreatedOrder },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  assertPaymentMethodAvailable: vi.fn(async () => ({ name: "Cash on Delivery", sandbox: true })),
  calculateDeliveryCharge: vi.fn(async () => ({ charge: 0 })),
  getBusinessSettings: vi.fn(async () => ({ currency: "BDT" })),
  getCourierCredential: vi.fn(), getPaymentCredential: vi.fn(),
}));
vi.mock("@/lib/payments/registry", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/couriers/registry", () => ({ getCourierProvider: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify, notifyOwners: mocks.notifyOwners }));
vi.mock("@/lib/marketing", () => ({ sendServerPurchaseEvent: vi.fn() }));
vi.mock("@/services/inventory", () => ({ adjustStock: mocks.adjustStock }));

import { placeOrder } from "@/services/orders";

const checkout = {
  productId: "product-1", variantId: "variant-1", quantity: 1, paymentMethod: "cod",
  deliveryOption: "inside_city" as const,
  customer: { name: "Test Buyer", phone: "01700000000", address: "123 Test Street", district: "Dhaka" },
};

function productWith(attributes: unknown) {
  return {
    id: "product-1", name: "Shirt", status: "PUBLISHED", regularPrice: 500, salePrice: null, sku: null,
    landingPage: null, images: [], variants: [{
      id: "variant-1", name: "Medium", sku: "M", price: null, stock: 7, imageUrl: null, isActive: true, attributes,
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findOrder.mockResolvedValue(null);
  mocks.countOrders.mockResolvedValue(0);
  mocks.findCreatedOrder.mockResolvedValue({ customerId: "customer-1" });
  mocks.customerUpsert.mockResolvedValue({ id: "customer-1" });
  mocks.createOrder.mockResolvedValue({ id: "order-1", orderNumber: "TEST-1", customerId: "customer-1", total: 500, currency: "BDT" });
  mocks.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback({
    $queryRaw: vi.fn().mockResolvedValue([{ id: "locked" }]), product: { findUnique: mocks.findProduct },
    customer: { upsert: mocks.customerUpsert }, order: { create: mocks.createOrder, findFirst: mocks.findOrder }, auditLog: { create: mocks.auditCreate },
  }));
});

describe("order snapshot attribute validation with mocked Prisma", () => {
  it.each([
    ["legacy map", { Size: "M, tall", Color: "Black" }],
    ["canonical array", [{ name: "Size", value: "M, tall" }]],
  ])("validates a %s and copies its original JSON into the new snapshot", async (_label, attributes) => {
    mocks.findProduct.mockResolvedValue(productWith(attributes));
    await placeOrder(checkout);
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      items: { create: expect.objectContaining({ variantId: "variant-1", attributes }) },
    }) }));
    expect(mocks.adjustStock).toHaveBeenCalledOnce();
  });

  it.each([
    ["partial singleton", { name: "Size" }],
    ["unknown array field", [{ name: "Size", value: "M", source: "do not discard" }]],
    ["null value", { Size: null }],
  ])("rejects %s before creating an order or changing stock", async (_label, attributes) => {
    mocks.findProduct.mockResolvedValue(productWith(attributes));
    await expect(placeOrder(checkout)).rejects.toThrow(/Cannot safely load attributes/);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.adjustStock).not.toHaveBeenCalled();
  });
});
