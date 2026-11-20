import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDatabase, createOwner, createBusiness, createProduct, checkout, setCourier, setPayment, closeAll } from "../helpers";
import { getCheckoutPaymentMethods, getPaymentConfigurations } from "@/lib/settings";
import { placeOrder, processPaymentCallback, assignManualCourier, bookCourierShipment, updateOrderStatus, getOrderByTrackingToken } from "@/services/orders";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

const bkashCredentials = { appKey: "key", appSecret: "secret", username: "user", password: "pass" };
let actorId: string;

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetDatabase();
  await createBusiness();
  actorId = (await createOwner()).id;
  await prisma.setting.createMany({
    data: [
      { key: "delivery", value: { insideCity: 60, outsideCity: 120, freeAbove: 0 } },
      { key: "notification_inapp", value: { enabled: true } },
    ],
  });
  await setPayment("cod", { enabled: true, visible: true, isDefault: true });
  for (const code of ["sslcommerz", "bkash", "nagad"]) await setPayment(code, { enabled: false, visible: false });
  for (const code of ["pathao", "steadfast", "redx"]) await setCourier(code, { enabled: false, visible: false });
});

afterAll(closeAll);

describe("Scenario A — COD-only business", () => {
  it("shows only COD, places an order without a gateway call and reduces stock", async () => {
    const product = await createProduct({ stock: 10 });
    const methods = await getCheckoutPaymentMethods();
    expect(methods.map((m) => m.code)).toEqual(["cod"]);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await placeOrder(checkout(product.id, product.variants[0].id, "cod"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.checkoutUrl).toBeNull();
    expect(result.order.paymentStatus).toBe("COD_PENDING");
    expect(result.order.status).toBe("PENDING");
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stock).toBe(9);
    expect(await prisma.stockMovement.count({ where: { type: "SALE" } })).toBe(1);
  });
});

describe("Scenario B — selective payment methods", () => {
  it("shows only enabled and configured methods and rejects disabled ones on the server", async () => {
    await setPayment("bkash", { enabled: true, visible: true, credentials: bkashCredentials });
    const product = await createProduct({ stock: 5 });
    const methods = await getCheckoutPaymentMethods();
    expect(methods.map((m) => m.code).sort()).toEqual(["bkash", "cod"]);
    await expect(placeOrder(checkout(product.id, product.variants[0].id, "sslcommerz"))).rejects.toThrow(/not available/);
    await expect(placeOrder(checkout(product.id, product.variants[0].id, "nagad"))).rejects.toThrow(/not available/);
  });

  it("hides enabled providers with missing credentials and flags them in dashboard config", async () => {
    await setPayment("bkash", { enabled: true, visible: true, credentials: {} });
    const methods = await getCheckoutPaymentMethods();
    expect(methods.map((m) => m.code)).toEqual(["cod"]);
    const configs = await getPaymentConfigurations();
    const bkash = configs.find((c) => c.code === "bkash");
    expect(bkash?.configured).toBe(false);
    expect(bkash?.status).toBe("unconfigured");
  });
});

describe("Scenario C — no COD", () => {
  it("does not offer COD when it is disabled", async () => {
    await setPayment("cod", { enabled: false, visible: false });
    await setPayment("bkash", { enabled: true, visible: true, credentials: bkashCredentials });
    const product = await createProduct();
    expect((await getCheckoutPaymentMethods()).map((m) => m.code)).toEqual(["bkash"]);
    await expect(placeOrder(checkout(product.id, product.variants[0].id, "cod"))).rejects.toThrow(/not available/);
  });
});

describe("Scenario D — no courier API", () => {
  it("supports manual assignment, tracking history, status updates and settlement", async () => {
    const product = await createProduct();
    const { order } = await placeOrder(checkout(product.id, product.variants[0].id, "cod"));
    await expect(bookCourierShipment(order.id, "pathao", actorId)).rejects.toThrow(/disabled/);
    await updateOrderStatus(order.id, "CONFIRMED", actorId);
    await updateOrderStatus(order.id, "READY_TO_SHIP", actorId);

    const shipment = await assignManualCourier({
      orderId: order.id, courierName: "Local Delivery", trackingId: "MANUAL-123",
      consignmentId: "C-99", cost: 50, codAmount: order.total, status: "IN_TRANSIT",
    }, actorId);
    expect(shipment.providerCode).toBe("manual");
    const events = await prisma.courierTrackingEvent.findMany({ where: { shipmentId: shipment.id } });
    expect(events[0].source).toBe("MANUAL");

    await updateOrderStatus(order.id, "SHIPPED", actorId, "Handed to local courier");
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
    expect(history[0].toStatus).toBe("SHIPPED");
    expect(history[0].source).toBe("MANUAL");

    const publicOrder = await getOrderByTrackingToken(order.trackingToken);
    expect(publicOrder).not.toBeNull();
    expect(Object.keys(publicOrder!)).not.toContain("internalNote");
    expect(Object.keys(publicOrder!.customer)).not.toContain("address");
  });
});

describe("Scenario E/F — provider behaviour", () => {
  it("rejects a courier provider that is disabled or has no credentials", async () => {
    const product = await createProduct();
    const { order } = await placeOrder(checkout(product.id, product.variants[0].id, "cod"));
    await setCourier("steadfast", { enabled: true, visible: true, credentials: {} });
    await expect(bookCourierShipment(order.id, "steadfast", actorId)).rejects.toThrow(/credentials/);
  });

  it("retains stock for reconciliation after an ambiguous provider initialization failure", async () => {
    await setPayment("bkash", { enabled: true, visible: true, credentials: bkashCredentials });
    const product = await createProduct({ stock: 4 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider offline")));
    await expect(placeOrder(checkout(product.id, product.variants[0].id, "bkash"))).rejects.toThrow(/Payment could not be started/);

    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } });
    expect(order.status).toBe("PENDING");
    expect(order.paymentStatus).toBe("PENDING");
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stock).toBe(3);
    expect(await prisma.stockMovement.count({ where: { type: "CANCELLATION" } })).toBe(0);
    expect((await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("INITIALIZATION_UNKNOWN");
    expect((await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } })).releasedAt).toBeNull();
  });

  it("verifies callbacks server-side and processes the same verification only once", async () => {
    await setPayment("sslcommerz", { enabled: true, visible: true, credentials: { storeId: "store", storePassword: "pass" } });
    const product = await createProduct({ stock: 4 });
    const { order } = await placeOrder(checkout(product.id, product.variants[0].id, "cod"));
    // Construct the already-initialized online state explicitly; this test is
    // about callback verification, not the provider's initiation contract.
    await prisma.order.update({ where: { id: order.id }, data: { paymentMethod: "sslcommerz", paymentStatus: "PENDING" } });
    await prisma.stockReservation.create({ data: { orderId: order.id, variantId: product.variants[0].id,
      quantity: 1, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    await prisma.paymentAttempt.create({ data: { orderId: order.id, provider: "sslcommerz", status: "INITIATED" } });
    const transaction = await prisma.paymentTransaction.create({
      data: { orderId: order.id, provider: "sslcommerz", reference: "tran-verify", amount: order.total, currency: order.currency, status: "INITIATED" },
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      status: "VALIDATED", tran_id: "tran-verify", amount: String(order.total), currency: order.currency,
    }), { status: 200 })));

    const first = await processPaymentCallback("sslcommerz", { val_id: "val-1", tran_id: "tran-verify" });
    const second = await processPaymentCallback("sslcommerz", { val_id: "val-1", tran_id: "tran-verify" });
    expect(first.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.paymentStatus).toBe("PAID");
    expect(updated.financialStatus).toBe("PARTIALLY_SETTLED");
    expect(updated.status).toBe("CONFIRMED");
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).status).toBe("PAID");
    expect(await prisma.webhookEvent.count({ where: { provider: "sslcommerz" } })).toBe(1);
  });

  it("rejects a callback when the provider is disabled", async () => {
    await expect(processPaymentCallback("nagad", { paymentRefId: "x", orderId: "y" })).rejects.toThrow(/disabled/);
  });
});

describe("inventory and permissions", () => {
  it("prevents overselling when two orders race for the last unit", async () => {
    const product = await createProduct({ stock: 1 });
    const first = checkout(product.id, product.variants[0].id, "cod");
    const second = checkout(product.id, product.variants[0].id, "cod");
    second.customer.phone = "01899999999";
    const results = await Promise.allSettled([placeOrder(first), placeOrder(second)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stock).toBe(0);
  });

  it("restores stock when an order is cancelled", async () => {
    const product = await createProduct({ stock: 3 });
    const { order } = await placeOrder(checkout(product.id, product.variants[0].id, "cod"));
    const { cancelOrder } = await import("@/services/orders");
    await cancelOrder(order.id, actorId, "Customer changed mind");
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stock).toBe(3);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).financialStatus).toBe("UNSETTLED");
  });

  it("enforces staff permission boundaries", () => {
    expect(hasPermission(["VIEWER"], PERMISSIONS.PAYMENT_SETTINGS)).toBe(false);
    expect(hasPermission(["ORDER_MANAGER"], PERMISSIONS.ORDER_WRITE)).toBe(true);
    expect(hasPermission(["ADMINISTRATOR"], PERMISSIONS.AUDIT_VIEW)).toBe(true);
  });
});
