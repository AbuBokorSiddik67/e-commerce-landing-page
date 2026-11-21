import { createHash, createHmac, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { CourierProviderConfiguration, CourierShipment, Order, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { orderNumber, randomToken } from "@/lib/crypto";
import { siteUrl } from "@/lib/config";
import { addressSchema, emailSchema, nameSchema, phoneSchema } from "@/lib/validation";
import { lineTotals, validateCoupon } from "@/lib/pricing";
import { normalizeStoredVariantAttributes } from "@/lib/product-attributes";
import { assertPaymentMethodAvailable, calculateDeliveryCharge, getBusinessSettings, getCourierCredentialFromSnapshot, getPaymentCredential } from "@/lib/settings";
import { getPaymentProvider } from "@/lib/payments/registry";
import { getCourierProvider } from "@/lib/couriers/registry";
import type { ShipmentInput } from "@/lib/couriers/types";
import { notify, notifyOwners } from "@/lib/notifications";
import { sendServerPurchaseEvent } from "@/lib/marketing";
import { checkRateLimit } from "@/lib/rate-limit";
import { CANCELLABLE_ORDER_STATUSES, COURIER_BOOKING_ORDER_STATUSES, MANUAL_ORDER_TRANSITIONS } from "@/lib/order-lifecycle";
import { compareStableIds, exactVariantQuantities } from "@/lib/inventory-invariants";
import { adjustStock, hasOtherOrderStockMovement, hasRecordedOrderSale } from "./inventory";
import { assertNoConflictingDispatchEvidence, assertNoUnresolvedCourier, hasConflictingDispatchEvidence, hasUnresolvedCourier, lockOrder } from "./order-lock";

export const checkoutSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(50),
  customer: z.object({
    name: nameSchema,
    phone: phoneSchema,
    email: emailSchema.optional().or(z.literal("")),
    address: addressSchema,
    district: z.string().trim().min(2).max(80),
    area: z.string().trim().max(80).optional(),
  }),
  deliveryOption: z.enum(["inside_city", "outside_city"]).default("inside_city"),
  paymentMethod: z.string().min(1),
  couponCode: z.string().trim().max(40).optional(),
  customerNote: z.string().max(1000).optional(),
  visitorId: z.string().max(100).optional(),
  ip: z.string().max(80).optional(),
  // Random UUIDv4 acts as a capability to retrieve the same checkout result.
  // Optional for legacy API clients, which retain the time-window guard.
  idempotencyKey: z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).optional(),
});

export type CheckoutInput = z.input<typeof checkoutSchema>;
type ParsedCheckout = z.output<typeof checkoutSchema>;
type CheckoutOperation = { id: string; fingerprint: string };

function checkoutOperation(input: ParsedCheckout): CheckoutOperation | null {
  if (!input.idempotencyKey) return null;
  const key = input.idempotencyKey.toLowerCase();
  const { idempotencyKey: _key, ip: _ip, visitorId: _visitor, ...details } = input;
  void _key; void _ip; void _visitor;
  return {
    // Reuse the existing primary-key constraint, as with receipt/refund claims.
    id: `checkout_${createHash("sha256").update(`landiq-checkout-v1:${key}`).digest("hex")}`,
    fingerprint: createHmac("sha256", key).update(JSON.stringify(["landiq-checkout-v1", details])).digest("hex"),
  };
}

/** Never restart an online payment during a replay, even when its outcome is unknown. */
async function replayCheckout(operation: CheckoutOperation) {
  const order = await prisma.order.findUnique({ where: { id: operation.id }, include: { payments: true } });
  if (!order) return null;
  const audits = await prisma.auditLog.findMany({ where: { entity: "Order", entityId: order.id, action: "ORDER_PLACED" },
    select: { after: true }, take: 2 });
  const marker = audits.length === 1 ? z.object({ checkoutFingerprint: z.string() }).safeParse(audits[0].after) : null;
  if (!marker?.success || marker.data.checkoutFingerprint !== operation.fingerprint) {
    throw new ConflictError("This checkout key was already used with different details or requires staff review");
  }
  if (["CANCELLED", "RETURNED"].includes(order.status)) {
    throw new ConflictError(`Order ${order.orderNumber} is closed; contact the store before placing another order`);
  }
  if (order.paymentMethod === "cod") return { order, checkoutUrl: null as string | null };
  if (order.paymentStatus === "PAID") return { order, checkoutUrl: null as string | null };
  if (order.status === "PENDING" && order.paymentStatus === "PENDING" && order.payments.length === 1
    && order.payments[0].provider === order.paymentMethod && order.payments[0].status === "INITIATED") {
    return { order, checkoutUrl: order.payments[0].checkoutUrl };
  }
  throw new ConflictError(`Order ${order.orderNumber} has an unresolved payment session. Do not place it again; contact the store.`);
}

export async function placeOrder(raw: CheckoutInput) {
  const input = checkoutSchema.parse(raw);
  if (input.ip) checkRateLimit(`order:${input.ip}:${input.customer.phone}`, 6, 10 * 60 * 1000);
  const operation = checkoutOperation(input);
  if (operation) {
    const existing = await replayCheckout(operation);
    if (existing) return existing;
  }
  try {
    return await placeNewOrder(input, operation);
  } catch (error) {
    // Another transaction may have committed the same key after the first
    // lookup, or a committed order may have lost its response. Never reissue
    // an external payment call while recovering that result.
    if (operation) {
      const existing = await replayCheckout(operation);
      if (existing) return existing;
    }
    throw error;
  }
}

async function placeNewOrder(input: ParsedCheckout, operation: CheckoutOperation | null) {
  // Server-side provider validation is mandatory: frontend visibility is never trusted.
  const method = await assertPaymentMethodAvailable(input.paymentMethod);

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { variants: true, landingPage: true, images: { orderBy: { position: "asc" }, take: 1 } },
  });
  if (!product || product.status !== "PUBLISHED") throw new ConflictError("This product is not available for ordering");
  const variant = product.variants.find((v) => v.id === input.variantId && v.isActive);
  if (!variant) throw new ConflictError("Selected variant is not available");
  if (variant.stock < input.quantity) throw new ConflictError(`Only ${variant.stock} units are available`);
  // Validate the exact stored value that will become the order snapshot. Do not
  // rewrite it: legacy snapshots and already-placed orders keep their shape.
  normalizeStoredVariantAttributes(variant.attributes, { productName: product.name, variantName: variant.name });

  // Keyed requests represent distinct explicit purchase operations. Preserve
  // the legacy heuristic for clients that do not yet send an operation key.
  if (!operation) {
    const duplicate = await prisma.order.findFirst({
      where: {
        customer: { phone: input.customer.phone },
        productId: product.id,
        createdAt: { gte: new Date(Date.now() - 15_000) },
      },
    });
    if (duplicate) throw new ConflictError("An order was just submitted. Please wait before repeating.");
  }

  const customerOrderCount = await prisma.order.count({ where: { customer: { phone: input.customer.phone } } });
  let discount = 0;
  let couponId: string | null = null;
  if (input.couponCode) {
    const coupon = await prisma.coupon.findUnique({ where: { code: input.couponCode.toUpperCase() } });
    const result = validateCoupon(coupon ? {
      code: coupon.code, type: coupon.type, value: coupon.value, minOrderValue: coupon.minOrderValue,
      maxDiscount: coupon.maxDiscount, productId: coupon.productId, expiresAt: coupon.expiresAt,
      startsAt: coupon.startsAt, usageLimit: coupon.usageLimit, usedCount: coupon.usedCount,
      firstOrderOnly: coupon.firstOrderOnly, isActive: coupon.isActive,
    } : null, { subtotal: (variant.price ?? product.salePrice ?? product.regularPrice) * input.quantity, productId: product.id, customerOrderCount });
    if (!result.valid) throw new ConflictError(result.reason ?? "Invalid coupon");
    discount = result.discount;
    couponId = coupon!.id;
  }

  const totals = lineTotals({
    regularPrice: product.regularPrice, salePrice: product.salePrice,
    variantPrice: variant.price, quantity: input.quantity, discount,
  });
  const delivery = await calculateDeliveryCharge({
    option: input.deliveryOption, district: input.customer.district, area: input.customer.area, subtotal: totals.subtotal,
  });
  totals.total = totals.subtotal - totals.discount + delivery.charge;
  const business = await getBusinessSettings();

  const order = await prisma.$transaction(async (tx) => {
    // Product editors/status changes lock the product before changing variants.
    // Lock in that same order, then re-read eligibility and every value used
    // for pricing or the item snapshot. A pre-transaction read is not enough.
    const lockedProduct = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Product" WHERE "id" = ${product.id} FOR SHARE
    `;
    const lockedVariant = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ProductVariant" WHERE "id" = ${variant.id} AND "productId" = ${product.id} FOR UPDATE
    `;
    if (!lockedProduct.length || !lockedVariant.length) throw new ConflictError("This product is no longer available");
    const current = await tx.product.findUnique({
      where: { id: product.id },
      include: { variants: true, landingPage: true, images: { orderBy: { position: "asc" }, take: 1 } },
    });
    const currentVariant = current?.variants.find((v) => v.id === variant.id);
    if (!current || current.status !== "PUBLISHED" || !currentVariant?.isActive) {
      throw new ConflictError("This product or variant is no longer available");
    }
    if (current.name !== product.name || current.sku !== product.sku || current.regularPrice !== product.regularPrice
      || current.salePrice !== product.salePrice || current.images[0]?.url !== product.images[0]?.url
      || currentVariant.name !== variant.name || currentVariant.sku !== variant.sku
      || currentVariant.price !== variant.price || currentVariant.imageUrl !== variant.imageUrl
      || !isDeepStrictEqual(currentVariant.attributes, variant.attributes)) {
      throw new ConflictError("This product changed while placing the order. Please review it and try again");
    }
    normalizeStoredVariantAttributes(currentVariant.attributes, { productName: current.name, variantName: currentVariant.name });

    const customer = await tx.customer.upsert({
      where: { phone: input.customer.phone },
      create: {
        name: input.customer.name, phone: input.customer.phone,
        email: input.customer.email || null,
        addresses: { create: { address: input.customer.address, district: input.customer.district, area: input.customer.area ?? null } },
      },
      update: { name: input.customer.name, email: input.customer.email || null },
    });
    // The preflight query is only an optimization. Serialize checkouts for the
    // same customer and recheck after that lock, so concurrent submissions of
    // different variants cannot both pass the time-window duplicate rule.
    const customerLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Customer" WHERE "id" = ${customer.id} FOR UPDATE
    `;
    if (!customerLock.length) throw new ConflictError("Customer details changed while placing the order");
    if (!operation) {
      const duplicateAfterLock = await tx.order.findFirst({ where: { customerId: customer.id, productId: product.id,
        createdAt: { gte: new Date(Date.now() - 15_000) } }, select: { id: true } });
      if (duplicateAfterLock) throw new ConflictError("An order was just submitted. Please wait before repeating.");
    }
    const created = await tx.order.create({
      data: {
        ...(operation ? { id: operation.id } : {}),
        orderNumber: orderNumber(),
        customerId: customer.id,
        productId: product.id,
        variantId: variant.id,
        quantity: input.quantity,
        subtotal: totals.subtotal,
        deliveryCharge: delivery.charge,
        discount: discount,
        total: totals.total,
        currency: business.currency,
        paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentMethod === "cod" ? "COD_PENDING" : "PENDING",
        deliveryOption: input.deliveryOption,
        address: input.customer.address,
        district: input.customer.district,
        area: input.customer.area ?? null,
        customerNote: input.customerNote ?? null,
        couponCode: input.couponCode?.toUpperCase() ?? null,
        trackingToken: randomToken(24),
        ip: input.ip ?? null,
        items: {
          create: {
            variantId: variant.id,
            name: product.name,
            sku: variant.sku ?? product.sku,
            unitPrice: totals.unitPrice,
            quantity: input.quantity,
            lineTotal: totals.subtotal,
            attributes: variant.attributes as never,
            imageUrl: variant.imageUrl || product.images[0]?.url || null,
          },
        },
        statusHistory: { create: { toStatus: "PENDING", source: "SYSTEM", note: "Order received" } },
        // COD stock belongs to a real order, not a time-limited payment hold.
        ...(input.paymentMethod === "cod" ? {} : {
          reservations: { create: { variantId: variant.id, quantity: input.quantity, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } },
          // Written before the provider call so an in-flight/unknown initiation
          // is never mistaken for a payment that is safe to expire or cancel.
          paymentAttempts: { create: { provider: input.paymentMethod, status: "INITIALIZING" } },
        }),
      },
    });

    await adjustStock(tx, {
      variantId: variant.id, delta: -input.quantity, type: "SALE",
      reason: `Order ${created.orderNumber}`, reference: created.id,
    });

    if (couponId) {
      await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
      await tx.couponRedemption.create({ data: { couponId, customerId: customer.id, orderId: created.id } });
    }
    await tx.auditLog.create({
      data: { action: "ORDER_PLACED", entity: "Order", entityId: created.id, after: { orderNumber: created.orderNumber,
        total: created.total, paymentMethod: input.paymentMethod, ...(operation ? { checkoutFingerprint: operation.fingerprint } : {}) } as never },
    });
    return created;
  });

  // Notification failure must not make a committed order look rolled back or
  // prevent payment initialization. A durable delivery mechanism is separate.
  try {
    await notifyOwners("NEW_ORDER", "New order received", `${order.orderNumber} · ৳${order.total} · ${method.name}`);
    await notify({
      type: "ORDER_RECEIVED", title: "We received your order",
      body: `Order ${order.orderNumber} has been received. We will contact ${input.customer.name} to confirm it.`,
      customerId: order.customerId,
      orderId: order.id, email: input.customer.email || null, phone: input.customer.phone,
      channels: ["IN_APP", "EMAIL", "SMS"],
    });
  } catch {
    // Delivery exceptions can contain addresses, tokens or provider payloads.
    console.error("Order committed but notification failed", { orderId: order.id });
  }

  if (input.paymentMethod === "cod") {
    return { order, checkoutUrl: null as string | null };
  }

  const provider = getPaymentProvider(input.paymentMethod);
  if (!provider) throw new ConflictError("Unknown payment provider");
  const baseUrl = siteUrl();
  let providerCalled = false;
  try {
    const credentials = await getPaymentCredential(input.paymentMethod);
    // Only failures before this point prove that no provider request was sent.
    providerCalled = true;
    const result = await provider.initialize({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: order.total,
      currency: order.currency,
      sandbox: method.sandbox,
      credentials,
      customer: {
        name: input.customer.name, email: input.customer.email || null, phone: input.customer.phone,
        address: input.customer.address, district: input.customer.district,
      },
      urls: {
        success: `${baseUrl}/api/payments/${input.paymentMethod}/callback`,
        fail: `${baseUrl}/checkout/failed?order=${order.orderNumber}`,
        cancel: `${baseUrl}/checkout/cancelled?order=${order.orderNumber}`,
        ipn: `${baseUrl}/api/payments/${input.paymentMethod}/ipn`,
      },
    });
    const stillOpen = await prisma.$transaction(async (tx) => {
      await lockOrder(tx, order.id);
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      const open = current.status === "PENDING" && current.paymentStatus === "PENDING";
      // Retain the provider reference even if an external/old writer closed the
      // order; a later payment then has a record for manual reconciliation.
      await tx.paymentTransaction.create({
        data: {
          orderId: order.id, provider: provider.code, reference: result.reference,
          status: open ? "INITIATED" : "RECONCILIATION_REQUIRED", amount: order.total, currency: order.currency, sandbox: method.sandbox,
          checkoutUrl: result.checkoutUrl ?? null, payload: (result.raw ?? {}) as never,
        },
      });
      await tx.paymentAttempt.updateMany({
        where: { orderId: order.id, provider: provider.code, status: "INITIALIZING" },
        data: { status: "INITIATED", response: (result.raw ?? {}) as never },
      });
      return open;
    });
    if (!stillOpen) throw new ConflictError("The order was closed during payment initialization; staff must reconcile the provider session");
    return { order, checkoutUrl: result.checkoutUrl ?? null };
  } catch (error) {
    // A timeout or local persistence error is not proof that the provider did
    // not create a payable session. Retain the stock and require reconciliation.
    try {
      await prisma.paymentAttempt.updateMany({
        where: { orderId: order.id, provider: provider.code, status: "INITIALIZING" },
        data: { status: providerCalled ? "INITIALIZATION_UNKNOWN" : "INITIALIZATION_NOT_STARTED" },
      });
    } catch (recordError) {
      console.error("Could not record uncertain payment initialization", { orderId: order.id,
        errorType: recordError instanceof Error ? recordError.name : "UnknownError" });
    }
    console.error("Payment initialization requires reconciliation", { orderId: order.id,
      errorType: error instanceof Error ? error.name : "UnknownError" });
    throw new ConflictError(`Payment could not be started reliably. Order ${order.orderNumber} is reserved for staff reconciliation; do not place it again until checked.`);
  }
}

type CancellationOrder = Prisma.OrderGetPayload<{
  include: { items: true; payments: true; paymentAttempts: true; reservations: true; refunds: true };
}>;

type CodEvidenceOrder = Pick<Order, "id" | "paymentStatus" | "paymentReference" | "financialStatus"
  | "settlementStatus" | "codCollectedAt" | "codSettledAt">;

/** Call under the order lock. A COD label alone is not proof that nothing was paid or refunded. */
async function assertConsistentCodPayment(tx: Prisma.TransactionClient, order: CodEvidenceOrder) {
  const pending = order.paymentStatus === "COD_PENDING" && order.financialStatus === "UNSETTLED"
    && order.settlementStatus === "PENDING" && !order.codCollectedAt && !order.codSettledAt;
  const collected = order.paymentStatus === "COD_COLLECTED" && Boolean(order.codCollectedAt)
    && ((order.financialStatus === "PARTIALLY_SETTLED" && order.settlementStatus === "PENDING" && !order.codSettledAt)
      || (order.financialStatus === "SETTLED" && order.settlementStatus === "SETTLED" && Boolean(order.codSettledAt)));
  if ((!pending && !collected) || order.paymentReference
    || await tx.paymentTransaction.findFirst({ where: { orderId: order.id }, select: { id: true } })
    || await tx.paymentAttempt.findFirst({ where: { orderId: order.id }, select: { id: true } })
    || await tx.refund.findFirst({ where: { orderId: order.id }, select: { id: true } })) {
    throw new ConflictError("COD payment evidence requires reconciliation before fulfillment or stock changes");
  }
}

const terminalFailureEvidenceSchema = z.object({
  landiqTerminalFailure: z.object({
    version: z.literal(1), provider: z.string(), reference: z.string().min(1), sandbox: z.boolean(),
  }),
});

function canReleaseOnlineHold(order: CancellationOrder) {
  // A status or attempt marker cannot override conflicting evidence that money
  // was collected, settled, refunded or associated with another reference.
  if (order.paymentReference || order.financialStatus !== "UNSETTLED" || order.settlementStatus !== "PENDING"
    || order.codCollectedAt || order.codSettledAt || order.refunds.length) return false;
  // A failure before the provider was invoked is provably unpaid. A timeout or
  // any exception after invocation is deliberately not treated the same way.
  const neverStarted = order.paymentStatus === "PENDING" && order.payments.length === 0
    && order.paymentAttempts.length === 1 && order.paymentAttempts[0].provider === order.paymentMethod
    && order.paymentAttempts[0].status === "INITIALIZATION_NOT_STARTED";
  // Old FAILED rows may have meant a merely pending response. A verified
  // terminal-session marker must bind to the only local transaction and the
  // sole initialization; unknown or additional attempts fail closed.
  const payment = order.payments.length === 1 ? order.payments[0] : undefined;
  const initializations = order.paymentAttempts.filter((attempt) => attempt.status === "INITIATED");
  const terminalProof = order.paymentAttempts.some((attempt) => {
    if (attempt.provider !== order.paymentMethod || attempt.status !== "VERIFIED_FAILURE") return false;
    const evidence = terminalFailureEvidenceSchema.safeParse(attempt.response);
    return evidence.success && evidence.data.landiqTerminalFailure.provider === order.paymentMethod
      && evidence.data.landiqTerminalFailure.reference === payment?.reference
      && evidence.data.landiqTerminalFailure.sandbox === payment?.sandbox;
  });
  const terminalFailure = order.paymentStatus === "FAILED" && payment?.provider === order.paymentMethod
    && payment.status === "FAILED" && Boolean(payment.reference?.trim()) && !payment.verifiedAt
    && payment.amount === order.total && payment.currency === order.currency && initializations.length === 1
    && order.paymentAttempts.every((attempt) => attempt.provider === order.paymentMethod
      && ["INITIATED", "VERIFIED_FAILURE", "FAILURE_REQUIRES_RECONCILIATION"].includes(attempt.status))
    && terminalProof;
  return neverStarted || terminalFailure;
}

function hasVerifiedOnlinePayment(order: CancellationOrder) {
  const payment = order.payments.length === 1 ? order.payments[0] : null;
  return order.paymentStatus === "PAID" && Boolean(order.paymentReference) && Boolean(payment?.verifiedAt)
    && payment?.status === "PAID" && payment.reference === order.paymentReference
    && payment.provider === order.paymentMethod && payment.amount === order.total && payment.currency === order.currency
    && order.refunds.every((refund) => ["RECORDED", "REFUNDED"].includes(refund.status));
}

/** Called with the order locked. False means retain stock, not reject cancellation. */
async function canReleaseCancellationStock(tx: Prisma.TransactionClient, order: CancellationOrder) {
  if (!CANCELLABLE_ORDER_STATUSES.includes(order.status) || await hasConflictingDispatchEvidence(tx, order)) return false;
  // A booking, including a pending claim, can already represent a handed-over
  // parcel. Local courier statuses are not proof of physical possession.
  if (await tx.courierShipment.findFirst({ where: { orderId: order.id }, select: { id: true } })) return false;
  const delivery = await tx.ownDelivery.findUnique({ where: { orderId: order.id } });
  if (delivery && !["ASSIGNED", "CANCELLED"].includes(delivery.status)) return false;
  if (delivery && await tx.ownDeliveryEvent.findFirst({ where: {
    deliveryId: delivery.id, status: { in: ["DISPATCHED", "OUT_FOR_DELIVERY", "FAILED", "DELIVERED", "RETURNING", "RETURNED"] },
  }, select: { id: true } })) return false;
  if (!order.items.length || order.items.some((item) => !item.variantId || !Number.isInteger(item.quantity) || item.quantity <= 0)
    || !(await hasRecordedOrderSale(tx, order.id, order.productId, order.items))
    || await hasOtherOrderStockMovement(tx, order.id)) return false;

  if (order.paymentMethod === "cod") {
    try { await assertConsistentCodPayment(tx, order); }
    catch (error) { if (error instanceof ConflictError) return false; throw error; }
  } else {
    if (!exactVariantQuantities(order.items, order.reservations)) return false;
    if (!hasVerifiedOnlinePayment(order)
      && (order.reservations.some((reservation) => reservation.releasedAt) || !canReleaseOnlineHold(order))) return false;
  }
  // Lock and check every target before recording cancellation, so missing or
  // full balances defer release instead of rolling the cancellation back.
  const totals = new Map<string, number>();
  for (const item of order.items) totals.set(item.variantId!, (totals.get(item.variantId!) ?? 0) + item.quantity);
  for (const [variantId, quantity] of [...totals].sort(([a], [b]) => compareStableIds(a, b))) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2_147_483_647) return false;
    const rows = await tx.$queryRaw<Array<{ stock: number }>>`
      SELECT "stock" FROM "ProductVariant" WHERE "id" = ${variantId} FOR UPDATE
    `;
    if (!rows.length || rows[0].stock < 0 || rows[0].stock > 2_147_483_647 - quantity) return false;
  }
  return true;
}

async function cancelOrderLocked(
  tx: Prisma.TransactionClient, orderId: string, actorId: string | null, reason: string, expiryBefore?: Date, customerToken?: string,
) {
  await lockOrder(tx, orderId);
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId }, include: { items: true, payments: true, paymentAttempts: true, reservations: true, refunds: true },
  });
  if (customerToken && order.trackingToken !== customerToken) throw new NotFoundError("Order not found");
  if (order.status === "CANCELLED") return { order, changed: false, stockReleased: Boolean(order.cancellationStockReleasedAt) };
  if (order.status === "RETURNED") throw new ConflictError("This order has already been fully returned");
  // Customers can cancel only pending COD orders, and only when the same
  // locked transaction can prove the stock release is safe. Managers retain
  // the separate reconciliation workflow for everything else.
  if (customerToken && (order.status !== "PENDING" || order.paymentMethod !== "cod" || order.paymentStatus !== "COD_PENDING")) {
    throw new ConflictError("This order can no longer be cancelled online. Please contact the store.");
  }
  const stockReleased = await canReleaseCancellationStock(tx, order);
  if (customerToken && !stockReleased) {
    throw new ConflictError("This order needs store review before cancellation. Please contact the store.");
  }
  if (expiryBefore) {
    const active = order.reservations.filter((reservation) => !reservation.releasedAt);
    if (!stockReleased || order.paymentMethod === "cod" || order.status !== "PENDING" || !active.length
      || active.some((reservation) => reservation.expiresAt > expiryBefore)) {
      throw new ConflictError("This reservation is not safely eligible for expiry");
    }
  }

  // Inspect the original history before appending the new cancellation event.
  // An inconsistent ASSIGNED row may nevertheless have physical dispatch or
  // conflicting courier evidence; do not rewrite it as a pre-dispatch event.
  const delivery = await tx.ownDelivery.findUnique({ where: { orderId } });
  const ownDeliveryRequiresReview = Boolean(delivery?.status === "ASSIGNED" && (
    !CANCELLABLE_ORDER_STATUSES.includes(order.status)
    || await hasConflictingDispatchEvidence(tx, order)
    || await tx.courierShipment.findFirst({ where: { orderId }, select: { id: true } })
  ));
  const now = new Date();
  await tx.order.update({ where: { id: order.id }, data: {
    status: "CANCELLED", cancelledAt: now, cancellationReason: reason,
    cancellationStockReleasedAt: stockReleased ? now : null,
  } });
  await tx.orderStatusHistory.create({
    data: { orderId, fromStatus: order.status, toStatus: "CANCELLED", source: expiryBefore ? "RESERVATION_EXPIRY" : "MANUAL", note: reason, createdById: actorId },
  });
  // A consistent pre-dispatch assignment must not send a cancelled order.
  if (delivery?.status === "ASSIGNED" && !ownDeliveryRequiresReview) {
    await tx.ownDelivery.update({ where: { id: delivery.id }, data: { status: "CANCELLED" } });
    await tx.ownDeliveryEvent.create({ data: { deliveryId: delivery.id, status: "CANCELLED", personId: delivery.personId,
      actorId, note: "Assignment cancelled before dispatch; warehouse receipt is separate" } });
  }
  if (stockReleased) {
    // Stable variant ordering prevents deadlocks for multi-item orders.
    for (const item of [...order.items].sort((a, b) => compareStableIds(a.variantId ?? "", b.variantId ?? ""))) {
      await adjustStock(tx, { variantId: item.variantId!, delta: item.quantity, type: "CANCELLATION",
        reason: `Undispatched cancellation ${order.orderNumber}`, reference: order.id, actorId });
    }
    await tx.stockReservation.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: now } });
  }
  await tx.auditLog.create({ data: { actorId, action: expiryBefore ? "EXPIRE_RESERVATION" : "CANCEL_ORDER",
    entity: "Order", entityId: orderId, before: { status: order.status },
    after: { status: "CANCELLED", reason, stockReleased, ownDeliveryRequiresReview } } });
  return { order, changed: true, stockReleased };
}

/** The tracking token is a secret capability; never accept an order ID here. */
export async function cancelCustomerOrder(trackingToken: string) {
  const token = z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/).parse(trackingToken);
  const pointer = await prisma.order.findUnique({ where: { trackingToken: token }, select: { id: true } });
  if (!pointer) throw new NotFoundError("Order not found");
  const result = await prisma.$transaction((tx) => cancelOrderLocked(tx, pointer.id, null, "Cancelled by customer", undefined, token));
  return { changed: result.changed, stockReleased: result.stockReleased };
}

export async function cancelOrder(orderId: string, actorId: string, reason: string) {
  const cleanReason = z.string().trim().min(1).max(500).parse(reason);
  const result = await prisma.$transaction((tx) => cancelOrderLocked(tx, orderId, actorId, cleanReason));
  if (result.changed) {
    try {
      await notify({
        type: "ORDER_CANCELLED", title: "Order cancelled", body: `Order ${result.order.orderNumber} was cancelled. ${cleanReason}`,
        orderId, channels: ["IN_APP", "EMAIL", "SMS"],
      });
    } catch {
      console.error("Cancellation committed but notification failed", { orderId });
    }
  }
  return { changed: result.changed, stockReleased: result.stockReleased };
}

/**
 * Manually runnable batch, not a scheduler. Only online holds with explicit
 * provably unstarted payments or provider-confirmed terminal unpaid sessions
 * qualify; COD, in-flight and unknown outcomes stay reserved. Current adapters
 * do not establish terminal-session proof. Late success needs reconciliation.
 */
export async function expireEligibleReservations(actorId: string, now = new Date(), limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isFinite(now.getTime())) {
    throw new ConflictError("Invalid reservation expiry batch");
  }
  const candidates = await prisma.stockReservation.findMany({
    where: {
      releasedAt: null, expiresAt: { lte: now },
      order: { status: "PENDING", paymentMethod: { not: "cod" }, OR: [
        { paymentStatus: "FAILED",
          paymentAttempts: { some: { status: "VERIFIED_FAILURE" }, none: { status: { in: ["INITIALIZING", "INITIALIZATION_UNKNOWN"] } } },
          payments: { some: { status: "FAILED" }, every: { status: "FAILED" } } },
        { paymentStatus: "PENDING", payments: { none: {} },
          paymentAttempts: { some: { status: "INITIALIZATION_NOT_STARTED" }, every: { status: "INITIALIZATION_NOT_STARTED" } } },
      ] },
    },
    select: { orderId: true }, orderBy: { expiresAt: "asc" }, take: limit,
  });
  let expired = 0;
  let deferred = 0;
  for (const orderId of new Set(candidates.map((candidate) => candidate.orderId))) {
    try {
      const result = await prisma.$transaction((tx) => cancelOrderLocked(tx, orderId, actorId, "Safely releasable unpaid reservation expired", now));
      if (result.changed) expired++;
    } catch (error) {
      if (!(error instanceof ConflictError || error instanceof NotFoundError)) throw error;
      deferred++;
    }
  }
  return { expired, deferred };
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending", CONFIRMED: "Confirmed", PROCESSING: "Processing", READY_TO_SHIP: "Ready to Ship",
  SHIPPED: "Shipped", OUT_FOR_DELIVERY: "Out for Delivery", DELIVERED: "Delivered",
  CANCELLED: "Cancelled", RETURNED: "Returned", FAILED_DELIVERY: "Failed Delivery",
};

type FulfillmentOrder = Prisma.OrderGetPayload<{ include: { items: true; reservations: true } }>;

/** Shared by manual fulfillment and courier creation; called with the order locked. */
export async function assertAllocatedForFulfillment(tx: Prisma.TransactionClient, order: FulfillmentOrder) {
  await assertNoConflictingDispatchEvidence(tx, order);
  const openReturn = await tx.returnRequest.findFirst({
    where: { orderId: order.id, status: { not: "REJECTED" } }, select: { id: true },
  });
  if (openReturn || await hasOtherOrderStockMovement(tx, order.id)) {
    throw new ConflictError("An active return or prior stock restoration or other activity requires reconciliation before fulfillment");
  }
  if (!(await hasRecordedOrderSale(tx, order.id, order.productId, order.items))) {
    throw new ConflictError("Order items and sale movements cannot be safely reconciled before fulfillment");
  }
  // A refund, including an in-flight provider claim, conflicts with starting or
  // advancing fulfillment. Payment status alone still says PAID after capture.
  if (order.paymentMethod !== "cod" && await tx.refund.findFirst({ where: { orderId: order.id }, select: { id: true } })) {
    throw new ConflictError("Refund evidence requires reconciliation before fulfillment");
  }
  if (order.paymentMethod === "cod") {
    await assertConsistentCodPayment(tx, order);
  } else {
    const payment = await tx.paymentTransaction.findFirst({ where: {
      orderId: order.id, provider: order.paymentMethod, reference: order.paymentReference, amount: order.total,
      currency: order.currency, status: "PAID", verifiedAt: { not: null },
    } });
    if (order.paymentStatus !== "PAID" || !order.paymentReference || !payment
      || !exactVariantQuantities(order.items, order.reservations)) {
      throw new ConflictError("Online orders must have verified payment and allocated stock before fulfillment");
    }
  }
}

export async function updateOrderStatus(orderId: string, status: OrderStatus, actorId: string, note?: string, source = "MANUAL") {
  if (status === "CANCELLED" || status === "RETURNED" || !(status in STATUS_LABELS)) {
    throw new ConflictError("Use the cancellation or return workflow for closed orders");
  }
  const result = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, reservations: true } });
    if (order.status === status) return { order, changed: false };
    if (!MANUAL_ORDER_TRANSITIONS[order.status].includes(status)) {
      throw new ConflictError(`Cannot change order from ${order.status} to ${status}`);
    }
    if (["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"].includes(status)
      && await tx.ownDelivery.findFirst({ where: { orderId, status: { not: "CANCELLED" } }, select: { id: true } })) {
      throw new ConflictError("Use the shop-delivery workflow to record physical delivery events");
    }
    await assertNoUnresolvedCourier(tx, orderId);
    await assertAllocatedForFulfillment(tx, order);
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status,
        confirmedAt: status === "CONFIRMED" ? new Date() : order.confirmedAt,
        shippedAt: status === "SHIPPED" ? new Date() : order.shippedAt,
        deliveredAt: status === "DELIVERED" ? new Date() : order.deliveredAt,
      },
    });
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: order.status, toStatus: status, source, note: note ?? null, createdById: source === "MANUAL" ? actorId : null },
    });
    await tx.stockReservation.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId, action: "ORDER_STATUS_CHANGED", entity: "Order", entityId: orderId,
      before: { status: order.status }, after: { status } } });
    return { order: updated, changed: true };
  });
  if (result.changed) {
    try {
      await notify({
        type: `ORDER_${status}`, title: `Order ${STATUS_LABELS[status].toLowerCase()}`,
        body: `Order ${result.order.orderNumber} is now ${STATUS_LABELS[status]}.`,
        orderId, customerId: result.order.customerId, channels: ["IN_APP", "EMAIL", "SMS"],
      });
    } catch {
      console.error("Order status committed but notification failed", { orderId });
    }
  }
  return result.order;
}

export async function processPaymentCallback(providerCode: string, payload: Record<string, unknown>) {
  const provider = getPaymentProvider(providerCode);
  if (!provider) throw new ConflictError("Unknown payment provider");
  const transactionRef = String(payload.paymentID ?? payload.tran_id ?? payload.tranId ?? payload.paymentRefId ?? payload.trxID ?? "");
  if (!transactionRef) throw new ConflictError("Callback is missing a transaction reference");
  const config = await prisma.paymentMethodConfiguration.findUnique({ where: { code: providerCode } });
  if (!config?.enabled) throw new ConflictError("Payment provider is disabled");
  // The request identifier is only a locator. It cannot establish success;
  // that still requires matching provider-returned evidence below.
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { provider_reference: { provider: providerCode, reference: transactionRef } },
  });
  if (!transaction) throw new NotFoundError("Unknown payment transaction");
  if (transaction.sandbox !== config.sandbox) {
    throw new ConflictError("Payment provider environment changed; staff reconciliation is required");
  }
  const credentials = await getPaymentCredential(providerCode);
  const verification = await provider.verify(payload, credentials, config.sandbox);
  if (!verification || !["PAID", "FAILED", "PENDING"].includes(verification.status)) {
    throw new ConflictError("The provider returned an unrecognized payment status; staff reconciliation is required");
  }
  // A caller-supplied identifier is not a substitute for a provider response.
  if (!verification.reference || verification.reference !== transactionRef) {
    throw new ConflictError("The provider did not verify this transaction reference");
  }
  // Never persist an arbitrary unauthenticated callback body or attacker-chosen
  // event IDs. Record at most one event per known, provider-verified reference.
  // Payment state/idempotency is still decided under the order lock below.
  await prisma.webhookEvent.upsert({
    where: { provider_eventId: { provider: providerCode, eventId: transactionRef } },
    create: { provider: providerCode, eventId: transactionRef, payload: { source: "provider-verification", status: verification.status } },
    update: {},
  });
  if (verification.status === "PAID" && (typeof verification.amount !== "number" || !Number.isSafeInteger(verification.amount) || verification.amount <= 0
    || verification.amount !== transaction.amount || !verification.currency || verification.currency !== transaction.currency)) {
    await prisma.paymentAttempt.create({ data: { orderId: transaction.orderId, provider: providerCode, status: "VERIFICATION_MISMATCH", response: verification.raw as never } });
    throw new ConflictError("The provider did not verify the exact payment amount and currency");
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, transaction.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: transaction.orderId }, include: {
      reservations: true, items: true, payments: true, paymentAttempts: true, refunds: true,
    } });
    const current = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    if (current.orderId !== order.id || current.amount !== order.total || current.currency !== order.currency
      || current.provider !== order.paymentMethod || current.reference !== verification.reference
      || current.sandbox !== config.sandbox || current.sandbox !== transaction.sandbox
      || (verification.status === "PAID" && (verification.amount !== current.amount || verification.currency !== current.currency))) {
      throw new ConflictError("Payment does not match the order; staff reconciliation is required");
    }
    if (current.verifiedAt && current.status === "PAID" && order.paymentStatus === "PAID"
      && order.paymentReference === current.reference && !["CANCELLED", "RETURNED"].includes(order.status)) {
      return { ok: true, duplicate: true, orderNumber: order.orderNumber, notify: false, reconcile: false };
    }
    if (current.verifiedAt && current.status === "PAID_REQUIRES_RECONCILIATION") {
      return { ok: false, duplicate: true, orderNumber: order.orderNumber, notify: false, reconcile: true };
    }
    if (verification.status === "PENDING") {
      return { ok: false, duplicate: false, orderNumber: order.orderNumber, notify: false, reconcile: false };
    }
    if (verification.status === "FAILED") {
      // Never downgrade a previously verified payment. An individual failed
      // attempt is not proof that the provider session cannot still be paid.
      if (current.verifiedAt || !["PENDING", "FAILED"].includes(order.paymentStatus)
        || !["INITIATED", "FAILED"].includes(current.status)) {
        throw new ConflictError("An authorized or verified payment cannot be replaced by a failure response");
      }
      if (verification.terminalFailureVerified !== true) {
        await tx.paymentAttempt.create({ data: { orderId: order.id, provider: providerCode,
          status: "FAILURE_REQUIRES_RECONCILIATION", response: verification.raw as never } });
        return { ok: false, duplicate: false, orderNumber: order.orderNumber, notify: false, reconcile: true };
      }
      await tx.paymentTransaction.update({ where: { id: current.id }, data: { status: "FAILED", payload: verification.raw as never } });
      await tx.paymentAttempt.create({ data: { orderId: order.id, provider: providerCode, status: "VERIFIED_FAILURE",
        response: { landiqTerminalFailure: { version: 1, provider: providerCode, reference: verification.reference, sandbox: current.sandbox },
          providerResponse: verification.raw } as never } });
      if (order.status === "PENDING") await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "FAILED" } });
      return { ok: false, duplicate: false, orderNumber: order.orderNumber, notify: false, reconcile: false };
    }

    const held = order.reservations.every((reservation) => !reservation.releasedAt)
      && exactVariantQuantities(order.items, order.reservations);
    const priorStockActivity = await hasOtherOrderStockMovement(tx, order.id);
    const recordedSale = await hasRecordedOrderSale(tx, order.id, order.productId, order.items);
    const unresolvedCourier = await hasUnresolvedCourier(tx, order.id);
    const conflictingDispatch = await hasConflictingDispatchEvidence(tx, order);
    const cleanFinancialEvidence = !order.paymentReference && order.financialStatus === "UNSETTLED"
      && order.settlementStatus === "PENDING" && !order.codCollectedAt && !order.codSettledAt && !order.refunds.length
      && order.payments.length === 1 && order.payments[0].id === current.id
      && ["INITIATED", "FAILED"].includes(current.status) && !current.verifiedAt
      && order.paymentAttempts.filter((attempt) => attempt.status === "INITIATED").length === 1
      && order.paymentAttempts.every((attempt) => {
        if (attempt.provider !== providerCode || !["INITIATED", "VERIFIED_FAILURE", "FAILURE_REQUIRES_RECONCILIATION"].includes(attempt.status)) return false;
        if (attempt.status !== "VERIFIED_FAILURE") return true;
        const evidence = terminalFailureEvidenceSchema.safeParse(attempt.response);
        return evidence.success && evidence.data.landiqTerminalFailure.provider === providerCode
          && evidence.data.landiqTerminalFailure.reference === current.reference
          && evidence.data.landiqTerminalFailure.sandbox === current.sandbox;
      });
    const canConfirm = order.status === "PENDING" && ["PENDING", "FAILED"].includes(order.paymentStatus)
      && held && !priorStockActivity && recordedSale && !unresolvedCourier && !conflictingDispatch && cleanFinancialEvidence;
    const now = new Date();
    await tx.paymentTransaction.update({ where: { id: current.id }, data: {
      status: canConfirm ? "PAID" : "PAID_REQUIRES_RECONCILIATION", verifiedAt: now, payload: verification.raw as never,
    } });
    await tx.order.update({ where: { id: order.id }, data: {
      paymentStatus: "PAID",
      // Do not erase a different legacy reference when recording a capture for review.
      paymentReference: order.paymentReference ?? verification.reference,
      // Provider capture is not evidence of a merchant payout/settlement.
      ...(order.financialStatus === "UNSETTLED" ? { financialStatus: "PARTIALLY_SETTLED" } : {}),
      ...(canConfirm ? { status: "CONFIRMED", confirmedAt: now } : {}),
    } });
    if (canConfirm) {
      await tx.stockReservation.updateMany({ where: { orderId: order.id, releasedAt: null }, data: { releasedAt: now } });
      await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: "CONFIRMED",
        source: "PAYMENT_PROVIDER", note: `Verified ${providerCode} payment ${verification.reference}` } });
    } else {
      await tx.paymentAttempt.create({ data: { orderId: order.id, provider: providerCode,
        status: "LATE_PAID_REQUIRES_RECONCILIATION", response: verification.raw as never } });
    }
    await tx.auditLog.create({ data: { action: canConfirm ? "PAYMENT_VERIFIED" : "PAYMENT_RECONCILIATION_REQUIRED",
      entity: "Order", entityId: order.id, after: { reference: verification.reference, provider: providerCode } } });
    return { ok: canConfirm, duplicate: false, orderNumber: order.orderNumber, notify: true, reconcile: !canConfirm };
  });
  if (result.notify) {
    try {
      await notifyOwners(result.reconcile ? "PAYMENT_RECONCILIATION_REQUIRED" : "PAYMENT_RECEIVED",
        result.reconcile ? "Payment requires reconciliation" : "Payment received", `${result.orderNumber} · ${provider.name}`);
      if (!result.reconcile) await sendServerPurchaseEvent({
        name: "Purchase", orderId: transaction.orderId, value: transaction.amount,
        currency: transaction.currency, visitorId: "server", email: null, phone: null,
      });
    } catch {
      console.error("Payment committed but post-payment delivery failed", { orderId: transaction.orderId });
    }
  }
  return { ok: result.ok, duplicate: result.duplicate, orderNumber: result.orderNumber, requiresReconciliation: result.reconcile };
}

// Store provider JSON without coercion or unsafe casts. A malformed response
// cannot be treated as a confirmed booking; the durable claim stays pending.
const jsonValueSchema: z.ZodType<Prisma.JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]));
const courierRawSchema = z.record(z.string(), jsonValueSchema);
const nonBlankReference = z.string().max(512).refine((value) => value.trim().length > 0);
const courierBookingSchema = z.object({
  consignmentId: nonBlankReference,
  trackingId: nonBlankReference,
  trackingUrl: z.string().max(2048).refine((value) => {
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  }).optional(),
  cost: z.number().int().nonnegative().max(2_147_483_647).optional(),
  raw: courierRawSchema,
});
export type CourierBookingEvidence = z.infer<typeof courierBookingSchema>;
type CourierRaw = z.infer<typeof courierRawSchema>;
type CourierClaimState = "AWAITING_RESULT" | "OUTCOME_UNKNOWN" | "RECONCILIATION_REQUIRED" | "BOOKED";

export const courierClaimMarkerSchema = z.object({
  landiqBooking: z.object({
    version: z.literal(4),
    state: z.enum(["AWAITING_RESULT", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED", "BOOKED"]),
    sandbox: z.boolean(),
    merchantReference: z.string(),
    orderStatusAtClaim: z.string(),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    configurationMac: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

type CourierRequest = Omit<ShipmentInput, "credentials">;
type CourierOrder = Prisma.OrderGetPayload<{ include: { items: true; reservations: true; product: true; customer: true } }>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => compareStableIds(a, b)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

function courierRequestFingerprint(order: CourierOrder, providerCode: string, request: CourierRequest) {
  // Include the whole relevant order/item snapshot and provider payload; in
  // particular online COD=0 is not a substitute for the order total, currency
  // or item quantities. An endpoint override may contain secrets, so it is
  // bound only by the keyed configuration MAC, not this unkeyed fingerprint.
  const { apiBaseOverride: _endpoint, ...providerPayload } = request;
  void _endpoint;
  const snapshot = {
    providerCode, request: providerPayload,
    order: { id: order.id, orderNumber: order.orderNumber, customerId: order.customerId, productId: order.productId,
      variantId: order.variantId, quantity: order.quantity, subtotal: order.subtotal, deliveryCharge: order.deliveryCharge,
      discount: order.discount, total: order.total, currency: order.currency, status: order.status,
      paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, paymentReference: order.paymentReference,
      financialStatus: order.financialStatus, settlementStatus: order.settlementStatus, deliveryOption: order.deliveryOption,
      address: order.address, district: order.district, area: order.area },
    customer: { id: order.customer.id, name: order.customer.name, phone: order.customer.phone, email: order.customer.email },
    product: { id: order.product.id, name: order.product.name, weightGrams: order.product.weightGrams },
    items: [...order.items].sort((a, b) => compareStableIds(a.id, b.id)).map((item) => ({
      id: item.id, variantId: item.variantId, name: item.name, sku: item.sku, quantity: item.quantity,
      unitPrice: item.unitPrice, lineTotal: item.lineTotal, attributes: item.attributes, imageUrl: item.imageUrl,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
}

export function courierEndpointOverride(providerCode: string) {
  return process.env[`${providerCode.toUpperCase()}_API_BASE`] ?? null;
}

export function courierConfigurationMac(config: CourierProviderConfiguration, credentials: ShipmentInput["credentials"],
  endpointOverride = courierEndpointOverride(config.code)) {
  // A keyed MAC, not credentials or an unkeyed secret hash, binds the claim to
  // the provider account, environment and endpoint override. Production already
  // requires this secret for credential encryption; rotation fails closed.
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production" && (!key || Buffer.byteLength(key, "utf8") < 32)) {
    throw new ConflictError("Courier configuration key is unavailable or too short");
  }
  return createHmac("sha256", key ?? "landiq-development-only-key").update(JSON.stringify(canonical({
    domain: "landiq-courier-config-v1", id: config.id, code: config.code, enabled: config.enabled, sandbox: config.sandbox,
    settings: config.settings, storedCredentials: config.credentials, credentials,
    apiBaseOverride: endpointOverride,
  }))).digest("hex");
}

export async function lockedCourierConfiguration(tx: Prisma.TransactionClient, providerCode: string) {
  await tx.$queryRaw`SELECT "id" FROM "CourierProviderConfiguration" WHERE "code" = ${providerCode} FOR SHARE`;
  return tx.courierProviderConfiguration.findUnique({ where: { code: providerCode } });
}

function courierClaimPayload(claim: PendingCourierClaim, state: CourierClaimState, raw?: CourierRaw): Prisma.InputJsonObject {
  return {
    landiqBooking: { version: 4, state, sandbox: claim.request.sandbox, merchantReference: claim.request.orderNumber,
      orderStatusAtClaim: claim.orderStatusAtClaim, requestFingerprint: claim.requestFingerprint, configurationMac: claim.configurationMac },
    ...(raw ? { providerResponse: raw } : {}),
  };
}

/** Hold mutable request dependencies through each local claim/finalization transaction. */
async function lockCourierRequestDependencies(tx: Prisma.TransactionClient, orderId: string) {
  // Call with the order locked. Checkout locks product before customer too;
  // neither of these locks survives into the provider call.
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { productId: true, customerId: true } });
  const products = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Product" WHERE "id" = ${order.productId} FOR SHARE
  `;
  const customers = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Customer" WHERE "id" = ${order.customerId} FOR SHARE
  `;
  if (!products.length || !customers.length) throw new ConflictError("Courier request details changed; staff reconciliation is required");
  // Existing item updates/deletes do not necessarily update the parent order.
  // Lock them through the snapshot read and claim/finalization commit as well.
  // Inserts reference the order and therefore wait on its FOR UPDATE lock.
  await tx.$queryRaw`SELECT "id" FROM "OrderItem" WHERE "orderId" = ${orderId} ORDER BY "id" FOR SHARE`;
}

function courierRequest(order: CourierOrder, sandbox: boolean, apiBaseOverride: string | null): CourierRequest {
  const weightGrams = order.product.weightGrams ?? 500;
  if (!Number.isInteger(weightGrams) || weightGrams <= 0 || !Number.isSafeInteger(order.total) || order.total < 0) {
    throw new ConflictError("Product weight or order amount requires review before courier booking");
  }
  return {
    orderNumber: order.orderNumber, customerName: order.customer.name, phone: order.customer.phone,
    address: order.address, district: order.district, area: order.area,
    // A recorded COD collection must not be requested from the courier again.
    codAmount: order.paymentMethod === "cod" && order.paymentStatus === "COD_PENDING" ? order.total : 0,
    weightGrams, items: [...order.items].sort((a, b) => compareStableIds(a.id, b.id)).map((item) => item.name).join(", "), sandbox, apiBaseOverride,
  };
}

async function assertCourierOrderEligible(tx: Prisma.TransactionClient, order: FulfillmentOrder) {
  if (!COURIER_BOOKING_ORDER_STATUSES.includes(order.status)) {
    throw new ConflictError("Courier booking requires a confirmed, unshipped order");
  }
  if (await tx.ownDelivery.findFirst({ where: { orderId: order.id, status: { not: "CANCELLED" } }, select: { id: true } })) {
    throw new ConflictError("This order is assigned to the shop's own delivery");
  }
  await assertAllocatedForFulfillment(tx, order);
}

const manualCourierSchema = z.object({
  orderId: z.string().min(1), courierName: z.string().trim().min(1).max(160),
  consignmentId: z.string().max(512).optional(), trackingId: z.string().max(512).optional(),
  cost: z.number().int().nonnegative().max(2_147_483_647).default(0),
  codAmount: z.number().int().nonnegative().max(2_147_483_647).default(0),
  status: z.enum(["BOOKED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]).default("BOOKED"),
  note: z.string().max(2000).optional(),
});

export async function assignManualCourier(raw: {
  orderId: string; courierName: string; consignmentId?: string; trackingId?: string;
  cost?: number; codAmount?: number; status?: string; note?: string;
}, actorId: string) {
  const input = manualCourierSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { items: true, reservations: true } });
    await assertCourierOrderEligible(tx, order);
    const maximumCod = order.paymentMethod === "cod" && order.paymentStatus === "COD_PENDING" ? order.total : 0;
    if (input.codAmount > maximumCod) throw new ConflictError("Courier COD amount exceeds the amount still due");

    const existing = await tx.courierShipment.findMany({ where: { orderId: order.id }, take: 2 });
    if (existing.length) {
      const prior = existing[0];
      const previousPayload = z.object({ courierName: z.string(), note: z.string().nullable() }).safeParse(prior.payload);
      if (existing.length === 1 && prior.providerCode === "manual" && prior.status === input.status
        && prior.consignmentId === (input.consignmentId ?? null) && prior.trackingId === (input.trackingId ?? null)
        && prior.cost === input.cost && prior.codAmount === input.codAmount && previousPayload.success
        && previousPayload.data.courierName === input.courierName && previousPayload.data.note === (input.note ?? null)) {
        return prior; // Exact retry, with no second external or local operation.
      }
      throw new ConflictError("A courier record already exists; do not assign another shipment without reconciliation");
    }
    const created = await tx.courierShipment.create({
      data: {
        orderId: order.id, providerCode: "manual", consignmentId: input.consignmentId ?? null,
        trackingId: input.trackingId ?? null, status: input.status, cost: input.cost, codAmount: input.codAmount,
        payload: { courierName: input.courierName, note: input.note ?? null }, createdById: actorId,
      },
    });
    await tx.courierTrackingEvent.create({
      data: {
        shipmentId: created.id, status: created.status,
        description: `Manually assigned to ${input.courierName}${input.note ? ` — ${input.note}` : ""}`,
        source: "MANUAL",
      },
    });
    await tx.order.update({ where: { id: order.id }, data: { courierFee: input.cost } });
    await tx.auditLog.create({ data: { actorId, action: "MANUAL_COURIER_ASSIGN", entity: "CourierShipment", entityId: created.id,
      after: { orderId: order.id, status: created.status } } });
    return created;
  });
}

export type PendingCourierClaim = {
  orderId: string; shipmentId: string; providerCode: string; actorId: string;
  orderStatusAtClaim: OrderStatus; request: CourierRequest; requestFingerprint: string; configurationMac: string;
};

type CourierClaimRecord = { orderId: string; providerCode: string; status: string; codAmount: number; payload: Prisma.JsonValue };
function matchesClaimIdentity(shipment: CourierClaimRecord, claim: PendingCourierClaim) {
  const marker = courierClaimMarkerSchema.safeParse(shipment.payload);
  return shipment.orderId === claim.orderId && shipment.providerCode === claim.providerCode
    && shipment.codAmount === claim.request.codAmount && marker.success
    && marker.data.landiqBooking.sandbox === claim.request.sandbox
    && marker.data.landiqBooking.merchantReference === claim.request.orderNumber
    && marker.data.landiqBooking.orderStatusAtClaim === claim.orderStatusAtClaim
    && marker.data.landiqBooking.requestFingerprint === claim.requestFingerprint
    && marker.data.landiqBooking.configurationMac === claim.configurationMac;
}

function isOurClaim(shipment: CourierClaimRecord, claim: PendingCourierClaim, state: "AWAITING_RESULT" | "BOOKED") {
  const marker = courierClaimMarkerSchema.safeParse(shipment.payload);
  return matchesClaimIdentity(shipment, claim) && shipment.status === (state === "BOOKED" ? "BOOKED" : "PENDING")
    && marker.success && marker.data.landiqBooking.state === state;
}

/** Best effort only: if this write also fails, the original PENDING claim still blocks retries and stock release. */
async function markCourierOutcomeUnknown(claim: PendingCourierClaim, evidence: CourierBookingEvidence | null, raw?: CourierRaw) {
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, claim.orderId);
    const shipment = await tx.courierShipment.findUnique({ where: { id: claim.shipmentId } });
    if (!shipment || !isOurClaim(shipment, claim, "AWAITING_RESULT")) return;
    const state = evidence ? "RECONCILIATION_REQUIRED" : "OUTCOME_UNKNOWN";
    const response = evidence?.raw ?? raw;
    const previous = shipment.payload as Prisma.JsonObject;
    // A damaged or pre-existing report is still evidence. If normal
    // finalization failed, never overwrite it in the best-effort fallback.
    if (previous.conflictingProviderResult !== undefined || previous.additionalProviderResults !== undefined
      || previous.providerResponse !== undefined || shipment.consignmentId || shipment.trackingId) {
      throw new ConflictError("Existing courier evidence requires investigation before annotating this claim");
    }
    const staffRejection = previous.landiqStaffRejection !== undefined;
    await tx.courierShipment.update({ where: { id: shipment.id }, data: {
      ...(evidence ? { consignmentId: evidence.consignmentId, trackingId: evidence.trackingId,
        trackingUrl: evidence.trackingUrl ?? null, cost: evidence.cost ?? 0 } : {}),
      payload: { ...previous, ...courierClaimPayload(claim, state, response),
        ...(staffRejection && evidence ? { conflictingProviderResult: { consignmentId: evidence.consignmentId,
          trackingId: evidence.trackingId, trackingUrl: evidence.trackingUrl ?? null, cost: evidence.cost ?? 0, raw: evidence.raw } } : {}) } as Prisma.InputJsonObject,
    } });
    await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id, status: "PENDING", source: "SYSTEM",
      description: "Courier outcome requires reconciliation. Do not retry or release stock.", raw: response ?? {} } });
    await tx.auditLog.create({ data: { actorId: claim.actorId, action: "COURIER_RECONCILIATION_REQUIRED",
      entity: "CourierShipment", entityId: shipment.id, after: { orderId: claim.orderId, state } } });
  });
}

/** Internal finalizer: repeated identical responses are idempotent; conflicting responses are retained for review. */
export async function finalizeCourierBooking(claim: PendingCourierClaim, rawBooking: CourierBookingEvidence) {
  const booking = courierBookingSchema.parse(rawBooking);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, claim.orderId);
    const shipment = await tx.courierShipment.findUniqueOrThrow({ where: { id: claim.shipmentId } });
    const existingPayload = shipment.payload && typeof shipment.payload === "object" && !Array.isArray(shipment.payload)
      ? shipment.payload as Prisma.JsonObject : {};
    const hasStaffRejection = existingPayload.landiqStaffRejection !== undefined;
    const hasPriorConflict = existingPayload.conflictingProviderResult !== undefined || existingPayload.additionalProviderResults !== undefined;
    if (shipment.status === "PENDING" && matchesClaimIdentity(shipment, claim) && (hasStaffRejection || hasPriorConflict)) {
      // A success arriving after a staff rejection or existing conflicting
      // evidence must never silently clear or overwrite any earlier report.
      const payload = existingPayload;
      const conflicting = { consignmentId: booking.consignmentId, trackingId: booking.trackingId,
        trackingUrl: booking.trackingUrl ?? null, cost: booking.cost ?? 0, raw: booking.raw };
      if (isDeepStrictEqual(payload.conflictingProviderResult, conflicting)) return { shipment, safe: false };
      const firstConflict = payload.conflictingProviderResult;
      const additional = payload.additionalProviderResults;
      if ((firstConflict !== undefined && (!firstConflict || typeof firstConflict !== "object" || Array.isArray(firstConflict)))
        || (additional !== undefined && !Array.isArray(additional))) throw new ConflictError("Malformed late-result history requires investigation");
      if (additional?.some((result) => isDeepStrictEqual(result, conflicting))) return { shipment, safe: false };
      const original = courierRawSchema.safeParse(payload.providerResponse);
      if (original.success && shipment.consignmentId === booking.consignmentId && shipment.trackingId === booking.trackingId
        && shipment.trackingUrl === (booking.trackingUrl ?? null) && shipment.cost === (booking.cost ?? 0)
        && isDeepStrictEqual(original.data, booking.raw)) return { shipment, safe: false };
      const marker = courierClaimMarkerSchema.parse(payload);
      const updated = await tx.courierShipment.update({ where: { id: shipment.id }, data: {
        status: "PENDING", payload: { ...payload, landiqBooking: { ...marker.landiqBooking, state: "RECONCILIATION_REQUIRED" },
          ...(firstConflict !== undefined ? { additionalProviderResults: [...(additional ?? []), conflicting] }
            : { conflictingProviderResult: conflicting }) } as Prisma.InputJsonObject,
      } });
      await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id, status: "PENDING", source: "API",
        description: "A late booking response conflicts with existing evidence; investigate every report.", raw: booking.raw } });
      await tx.auditLog.create({ data: { actorId: claim.actorId, action: "COURIER_RECONCILIATION_REQUIRED", entity: "CourierShipment",
        entityId: shipment.id, after: { orderId: claim.orderId, conflicting: true } } });
      return { shipment: updated, safe: false };
    }
    const previouslyBooked = isOurClaim(shipment, claim, "BOOKED");
    if (!previouslyBooked && !isOurClaim(shipment, claim, "AWAITING_RESULT")) {
      const staffResolution = z.object({ landiqStaffResolution: z.object({ kind: z.literal("BOOKING_RECORDED") }) }).safeParse(shipment.payload);
      // The booking may have been recovered and then staff-recorded as
      // cancelled while the original booking call was still in flight. Do not
      // discard a late response or reopen a cancelled shipment silently.
      if (shipment.status === "CANCELLED" && staffResolution.success
        && isOurClaim({ ...shipment, status: "BOOKED" }, claim, "BOOKED")) {
        const payload = shipment.payload as Prisma.JsonObject;
        const same = shipment.consignmentId === booking.consignmentId && shipment.trackingId === booking.trackingId;
        const priorLate = z.object({ landiqLateBooking: z.object({ consignmentId: z.string(), trackingId: z.string(), raw: courierRawSchema }) }).safeParse(payload);
        if (same && priorLate.success && priorLate.data.landiqLateBooking.consignmentId === booking.consignmentId
          && priorLate.data.landiqLateBooking.trackingId === booking.trackingId && isDeepStrictEqual(priorLate.data.landiqLateBooking.raw, booking.raw)) {
          return { shipment, safe: false };
        }
        const updated = await tx.courierShipment.update({ where: { id: shipment.id }, data: same ? {
          payload: { ...payload, landiqLateBooking: { consignmentId: booking.consignmentId, trackingId: booking.trackingId, raw: booking.raw } } as Prisma.InputJsonObject,
        } : {
          status: "PENDING", payload: { ...payload,
            landiqBooking: { ...courierClaimMarkerSchema.parse(payload).landiqBooking, state: "RECONCILIATION_REQUIRED" },
            conflictingProviderResult: { consignmentId: booking.consignmentId, trackingId: booking.trackingId,
              trackingUrl: booking.trackingUrl ?? null, cost: booking.cost ?? 0, raw: booking.raw } } as Prisma.InputJsonObject,
        } });
        if (!same) {
          const cancellation = await tx.courierOperation.findUnique({ where: { shipmentId_kind: { shipmentId: shipment.id, kind: "CANCEL" } } });
          if (cancellation?.status === "RECONCILED") await tx.courierOperation.update({ where: { id: cancellation.id }, data: { status: "RECONCILIATION_REQUIRED" } });
        }
        await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id, status: same ? "CANCELLED" : "PENDING", source: "API",
          description: same ? "Late booking response matched the staff-recorded cancelled parcel."
            : "A late booking response conflicts with the recorded parcel; investigate every reference.", raw: booking.raw } });
        await tx.auditLog.create({ data: { actorId: claim.actorId, action: same ? "COURIER_LATE_BOOKING_MATCHED" : "COURIER_RECONCILIATION_REQUIRED",
          entity: "CourierShipment", entityId: shipment.id, after: { orderId: claim.orderId, conflicting: !same } } });
        return { shipment: updated, safe: false };
      }
      throw new ConflictError("Courier claim changed; reconciliation is required");
    }
    const currentConfig = await lockedCourierConfiguration(tx, claim.providerCode);
    const configUnchanged = Boolean(currentConfig && currentConfig.enabled && courierConfigurationMac(currentConfig,
      await getCourierCredentialFromSnapshot(claim.providerCode, currentConfig.credentials)) === claim.configurationMac);
    await lockCourierRequestDependencies(tx, claim.orderId);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: claim.orderId }, include: { items: true, reservations: true, product: true, customer: true },
    });
    const otherShipment = await tx.courierShipment.findFirst({ where: { orderId: claim.orderId, id: { not: shipment.id } }, select: { id: true } });
    let safe = configUnchanged && !otherShipment && order.status === claim.orderStatusAtClaim;
    if (safe) {
      try {
        await assertCourierOrderEligible(tx, order);
        const latestRequest = courierRequest(order, claim.request.sandbox, courierEndpointOverride(claim.providerCode));
        safe = isDeepStrictEqual(latestRequest, claim.request)
          && courierRequestFingerprint(order, claim.providerCode, latestRequest) === claim.requestFingerprint;
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        safe = false;
      }
    }
    const priorPayload = z.object({ providerResponse: courierRawSchema }).safeParse(shipment.payload);
    const staffResolution = z.object({ landiqStaffResolution: z.object({ kind: z.literal("BOOKING_RECORDED") }) }).safeParse(shipment.payload);
    const sameStaffReferences = previouslyBooked && staffResolution.success
      && shipment.consignmentId === booking.consignmentId && shipment.trackingId === booking.trackingId;
    if (sameStaffReferences && configUnchanged && !otherShipment) {
      if (priorPayload.success && shipment.trackingUrl === (booking.trackingUrl ?? null) && shipment.cost === (booking.cost ?? 0)
        && isDeepStrictEqual(priorPayload.data.providerResponse, booking.raw)) return { shipment, safe };
      // Staff may have recovered the known booking while the original request
      // was still in flight. Matching late evidence enriches that same record;
      // it is not a conflicting second parcel and never reopens the order.
      const payload = shipment.payload as Prisma.JsonObject;
      const updated = await tx.courierShipment.update({ where: { id: shipment.id }, data: {
        trackingUrl: booking.trackingUrl ?? null, cost: booking.cost ?? 0,
        payload: { ...payload, providerResponse: booking.raw } as Prisma.InputJsonObject,
      } });
      await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id, status: "BOOKED", source: "API",
        description: "Late provider response matched the staff-recorded booking.", raw: booking.raw } });
      await tx.auditLog.create({ data: { actorId: claim.actorId, action: "COURIER_LATE_BOOKING_MATCHED", entity: "CourierShipment",
        entityId: shipment.id, after: { orderId: claim.orderId, safeToFulfill: safe } } });
      return { shipment: updated, safe };
    }
    const exactResponse = previouslyBooked && priorPayload.success
      && shipment.consignmentId === booking.consignmentId && shipment.trackingId === booking.trackingId
      && shipment.trackingUrl === (booking.trackingUrl ?? null) && shipment.cost === (booking.cost ?? 0)
      && isDeepStrictEqual(priorPayload.data.providerResponse, booking.raw);
    if (previouslyBooked && safe && exactResponse) return { shipment, safe: true };
    // A different second provider response may describe another real shipment.
    // Preserve both reports rather than silently choosing one or booking again.
    if (previouslyBooked && !exactResponse) safe = false;
    const state = safe ? "BOOKED" : "RECONCILIATION_REQUIRED";
    const priorResponse = priorPayload.success ? priorPayload.data.providerResponse : undefined;
    const payload = previouslyBooked ? {
      // Preserve staff provenance and any other existing evidence when a
      // later provider response changes a booked claim to reconciliation.
      ...existingPayload,
      ...courierClaimPayload(claim, state, priorResponse),
      ...(!exactResponse ? { conflictingProviderResult: { consignmentId: booking.consignmentId, trackingId: booking.trackingId,
        trackingUrl: booking.trackingUrl ?? null, cost: booking.cost ?? 0, raw: booking.raw } } : {}),
    } : courierClaimPayload(claim, state, booking.raw);
    const updated = await tx.courierShipment.update({ where: { id: shipment.id }, data: {
      status: safe ? "BOOKED" : "PENDING",
      // Never replace the first reported references with a conflicting second report.
      ...(!previouslyBooked ? { consignmentId: booking.consignmentId, trackingId: booking.trackingId,
        trackingUrl: booking.trackingUrl ?? null, cost: booking.cost ?? 0 } : {}), payload,
    } });
    await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id, status: safe ? "BOOKED" : "PENDING", source: "API",
      description: safe ? "Shipment booked via provider API" : "Provider reported a booking, but local state or responses conflict; reconcile before release.",
      raw: booking.raw } });
    if (safe) await tx.order.update({ where: { id: claim.orderId }, data: { courierFee: booking.cost ?? 0 } });
    await tx.auditLog.create({ data: { actorId: claim.actorId, action: safe ? "COURIER_BOOKED" : "COURIER_RECONCILIATION_REQUIRED",
      entity: "CourierShipment", entityId: shipment.id, after: { orderId: claim.orderId, providerCode: claim.providerCode, state } } });
    return { shipment: updated, safe };
  });
}

export async function bookCourierShipment(orderId: string, providerCode: string, actorId: string) {
  // Configuration and credentials are checked before creating a claim. Once
  // claimed, all exceptions are conservatively treated as potentially sent.
  const config = await prisma.courierProviderConfiguration.findUnique({ where: { code: providerCode } });
  if (!config?.enabled) throw new ConflictError("This courier provider is disabled");
  const provider = getCourierProvider(providerCode);
  if (!provider) throw new ConflictError("Unknown courier provider");
  const credentials = await getCourierCredentialFromSnapshot(providerCode, config.credentials);
  if (!provider.credentialsValid(credentials)) throw new ConflictError("Courier credentials are not configured");
  // The same endpoint snapshot is MAC-bound and passed to the adapter;
  // a transient process-environment change cannot redirect an in-flight call.
  const endpointOverride = courierEndpointOverride(providerCode);
  const configurationMac = courierConfigurationMac(config, credentials, endpointOverride);

  const start = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const currentConfig = await lockedCourierConfiguration(tx, providerCode);
    if (!currentConfig || !currentConfig.enabled || courierConfigurationMac(currentConfig,
      await getCourierCredentialFromSnapshot(providerCode, currentConfig.credentials)) !== configurationMac) {
      throw new ConflictError("Courier configuration changed; reload before booking");
    }
    await lockCourierRequestDependencies(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId }, include: { items: true, reservations: true, product: true, customer: true },
    });
    await assertCourierOrderEligible(tx, order);
    const request = courierRequest(order, config.sandbox, endpointOverride);
    const requestFingerprint = courierRequestFingerprint(order, providerCode, request);
    const existing = await tx.courierShipment.findMany({ where: { orderId }, take: 2 });
    if (existing.length) {
      const prior = existing[0];
      const marker = courierClaimMarkerSchema.safeParse(prior.payload);
      if (existing.length === 1 && prior.providerCode === providerCode && prior.status === "BOOKED"
        && marker.success && marker.data.landiqBooking.state === "BOOKED"
        && marker.data.landiqBooking.sandbox === config.sandbox && prior.codAmount === request.codAmount
        && marker.data.landiqBooking.merchantReference === order.orderNumber
        && marker.data.landiqBooking.requestFingerprint === requestFingerprint
        && marker.data.landiqBooking.configurationMac === configurationMac) {
        return { kind: "existing" as const, shipment: prior };
      }
      throw new ConflictError("A courier record already exists or is unresolved; do not retry without reconciliation");
    }
    // This committed row is the durable claim. A crash at ANY point after it
    // is created remains indistinguishable from a sent request and fails closed.
    const claim: PendingCourierClaim = { orderId, shipmentId: `courier_${randomUUID()}`, providerCode, actorId,
      orderStatusAtClaim: order.status, request, requestFingerprint, configurationMac };
    const shipment = await tx.courierShipment.create({ data: {
      id: claim.shipmentId, orderId, providerCode, status: "PENDING", codAmount: request.codAmount, createdById: actorId,
      payload: courierClaimPayload(claim, "AWAITING_RESULT"),
    } });
    await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id, status: "PENDING", source: "SYSTEM",
      description: "Courier booking claimed; the request may be in flight. Do not retry or release stock." } });
    await tx.auditLog.create({ data: { actorId, action: "COURIER_BOOKING_CLAIMED", entity: "CourierShipment", entityId: shipment.id,
      after: { orderId, providerCode, sandbox: config.sandbox } } });
    return { kind: "claimed" as const, claim };
  });
  if (start.kind === "existing") return start.shipment;
  const claim = start.claim;
  let evidence: CourierBookingEvidence | null = null;
  let raw: CourierRaw | undefined;
  let completion: { shipment: CourierShipment; safe: boolean };
  try {
    // No transaction or row lock is held while a courier may take 20+ seconds.
    const response = await provider.createShipment({ ...claim.request, credentials });
    const rawResult = courierRawSchema.safeParse(response.raw);
    if (rawResult.success) raw = rawResult.data;
    const booking = courierBookingSchema.parse(response);
    evidence = booking;
    completion = await finalizeCourierBooking(claim, booking);
  } catch (error) {
    try { await markCourierOutcomeUnknown(claim, evidence, raw); }
    catch (recordError) {
      console.error("Could not annotate an unresolved courier claim", { orderId, shipmentId: claim.shipmentId,
        errorType: recordError instanceof Error ? recordError.name : "UnknownError" });
    }
    console.error("Courier booking outcome requires reconciliation", { orderId, shipmentId: claim.shipmentId,
      errorType: error instanceof Error ? error.name : "UnknownError" });
    throw new ConflictError("Courier booking may have been created. Do not retry or release stock; staff must reconcile with the provider.");
  }
  if (!completion.safe) {
    throw new ConflictError("The courier reported a booking, but the order changed. Do not retry or release stock; staff must reconcile it.");
  }
  return completion.shipment;
}

export async function syncCourierTracking(shipmentId: string, actorId: string) {
  const shipment = await prisma.courierShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { order: true } });
  const marker = courierClaimMarkerSchema.safeParse(shipment.payload);
  const reference = shipment.trackingId ?? shipment.consignmentId;
  if (shipment.providerCode === "manual") throw new ConflictError("Manual shipments cannot be synced with an API");
  if (shipment.status === "PENDING" || !reference || !marker.success || marker.data.landiqBooking.state !== "BOOKED"
    || marker.data.landiqBooking.merchantReference !== shipment.order.orderNumber) {
    throw new ConflictError("Courier booking or original account is unresolved; reconcile before tracking");
  }
  const provider = getCourierProvider(shipment.providerCode);
  if (!provider) throw new ConflictError("Unknown courier provider");
  const config = await prisma.courierProviderConfiguration.findUnique({ where: { code: shipment.providerCode } });
  if (!config?.enabled) throw new ConflictError("Courier provider is disabled");
  const credentials = await getCourierCredentialFromSnapshot(shipment.providerCode, config.credentials);
  const endpoint = courierEndpointOverride(shipment.providerCode);
  const mac = courierConfigurationMac(config, credentials, endpoint);
  if (marker.data.landiqBooking.sandbox !== config.sandbox || marker.data.landiqBooking.configurationMac !== mac) {
    throw new ConflictError("Courier account or endpoint changed; reconcile before tracking");
  }
  // Network I/O occurs without a database transaction. Only recognized enum
  // values are stored; untrusted provider descriptions/raw echoes are not.
  const result = await provider.getTracking(reference, credentials, config.sandbox, endpoint);
  const normalized = typeof result.status === "string" ? result.status.trim().toUpperCase().replace(/[ -]+/g, "_") : "";
  const known = ["PENDING", "BOOKED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "FAILED"] as const;
  const status = known.find((value) => value === normalized);
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, shipment.orderId);
    const current = await tx.courierShipment.findUniqueOrThrow({ where: { id: shipmentId } });
    const currentMarker = courierClaimMarkerSchema.safeParse(current.payload);
    const currentConfig = await lockedCourierConfiguration(tx, shipment.providerCode);
    if (current.orderId !== shipment.orderId || current.providerCode !== shipment.providerCode
      || (current.trackingId ?? current.consignmentId) !== reference || current.status === "PENDING"
      || !currentMarker.success || currentMarker.data.landiqBooking.state !== "BOOKED"
      || currentMarker.data.landiqBooking.configurationMac !== mac || !currentConfig?.enabled
      || courierConfigurationMac(currentConfig, await getCourierCredentialFromSnapshot(shipment.providerCode, currentConfig.credentials), endpoint) !== mac) {
      throw new ConflictError("Courier details changed while tracking; reconcile before recording the result");
    }
    await tx.courierTrackingEvent.create({ data: { shipmentId, status: status ?? current.status,
      description: status ? `Provider reported ${status}` : "Provider returned an unrecognized status; check its portal.",
      eventAt: result.at instanceof Date && Number.isFinite(result.at.getTime()) ? result.at : new Date(),
      source: "API", raw: { recognized: Boolean(status) } } });
    await tx.auditLog.create({ data: { actorId, action: "COURIER_SYNC", entity: "CourierShipment", entityId: shipmentId,
      after: { status: status ?? "UNRECOGNIZED" } } });
  });
  return { status: status ?? "UNRECOGNIZED" };
}

export async function collectCod(orderId: string, amount: number, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.paymentMethod !== "cod") throw new ConflictError("Order is not a COD order");
    if (["CANCELLED", "RETURNED"].includes(order.status)) throw new ConflictError("A closed order cannot be collected");
    // There is no persisted collected-amount field. Do not imply that an
    // unrecorded partial payment is a full collection or can be settled.
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount !== order.total) throw new ConflictError("COD collection must equal the full order total");
    await assertConsistentCodPayment(tx, order);
    if (order.paymentStatus === "COD_COLLECTED") return order;
    await assertNoConflictingDispatchEvidence(tx, order);
    await assertNoUnresolvedCourier(tx, orderId);
    const openReturn = await tx.returnRequest.findFirst({ where: { orderId, status: { not: "REJECTED" } }, select: { id: true } });
    if (openReturn || await hasOtherOrderStockMovement(tx, orderId)) {
      throw new ConflictError("An active return or prior stock activity requires reconciliation before collecting COD");
    }
    if (!(await hasRecordedOrderSale(tx, orderId, order.productId, order.items))) {
      throw new ConflictError("Order items and sale movements cannot be safely reconciled before collecting COD");
    }
    const updated = await tx.order.update({ where: { id: orderId },
      data: { paymentStatus: "COD_COLLECTED", codCollectedAt: new Date(), financialStatus: "PARTIALLY_SETTLED" } });
    await tx.auditLog.create({ data: { actorId, action: "COD_COLLECTED", entity: "Order", entityId: orderId, after: { amount } } });
    return updated;
  });
}

export async function settleCod(orderId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.paymentMethod !== "cod") throw new ConflictError("Order is not a COD order");
    if (order.status === "CANCELLED" || order.paymentStatus !== "COD_COLLECTED") throw new ConflictError("COD must be collected before settlement");
    await assertConsistentCodPayment(tx, order);
    if (order.settlementStatus === "SETTLED") return order;
    await assertNoUnresolvedCourier(tx, orderId);
    const updated = await tx.order.update({ where: { id: orderId },
      data: { settlementStatus: "SETTLED", financialStatus: "SETTLED", codSettledAt: new Date() } });
    await tx.auditLog.create({ data: { actorId, action: "COD_SETTLED", entity: "Order", entityId: orderId } });
    return updated;
  });
}

export async function listOrders(options: {
  search?: string; status?: string; paymentMethod?: string; from?: string; to?: string; page?: number; perPage?: number;
} = {}) {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, options.perPage ?? 20);
  const where: Prisma.OrderWhereInput = {
    ...(options.search ? { OR: [
      { orderNumber: { contains: options.search, mode: "insensitive" } },
      { customer: { phone: { contains: options.search } } },
      { customer: { name: { contains: options.search, mode: "insensitive" } } },
    ] } : {}),
    ...(options.status ? { status: options.status as OrderStatus } : {}),
    ...(options.paymentMethod ? { paymentMethod: options.paymentMethod } : {}),
    ...(options.from || options.to ? {
      createdAt: {
        ...(options.from ? { gte: new Date(options.from) } : {}),
        ...(options.to ? { lte: new Date(`${options.to}T23:59:59`) } : {}),
      },
    } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { customer: true, product: { select: { name: true, slug: true } }, items: true, shipments: true },
      orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage,
    }),
    prisma.order.count({ where }),
  ]);
  return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
}

export async function getOrderForAdmin(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      customer: { include: { addresses: true } },
      product: true, items: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      shipments: { include: { trackingEvents: { orderBy: { eventAt: "desc" } }, operations: true } },
      ownDelivery: { include: { person: { select: { id: true, name: true, isActive: true } },
        events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } }, person: { select: { name: true } } } } } },
      payments: true, refunds: true,
      returns: { include: { receipts: { orderBy: { createdAt: "asc" }, include: { orderItem: true,
        receivedBy: { select: { name: true } }, inspectedBy: { select: { name: true } } } } } },
      redemptions: true, reviews: true,
    },
  });
}

/** Explicit allow-list: public tracking must never receive internal notes or full addresses. */
export async function getOrderByTrackingToken(token: string) {
  return prisma.order.findUnique({
    where: { trackingToken: token },
    select: {
      id: true, orderNumber: true, createdAt: true, status: true, total: true,
      paymentMethod: true, paymentStatus: true, deliveryOption: true, expectedDeliveryAt: true, district: true, area: true,
      items: { select: { name: true, quantity: true } },
      product: { select: { name: true, slug: true, images: { take: 1, orderBy: { position: "asc" } } } },
      statusHistory: {
        where: { source: { not: "INTERNAL" } },
        orderBy: { createdAt: "asc" },
        select: { id: true, toStatus: true, createdAt: true, source: true },
      },
      shipments: { select: { providerCode: true, trackingId: true, trackingUrl: true, status: true, createdAt: true, payload: true } },
      customer: { select: { name: true, phone: true } },
    },
  });
}

export { STATUS_LABELS };
