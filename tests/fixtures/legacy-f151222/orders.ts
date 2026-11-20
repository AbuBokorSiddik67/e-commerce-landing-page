import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { orderNumber, randomToken } from "@/lib/crypto";
import { addressSchema, emailSchema, nameSchema, phoneSchema } from "@/lib/validation";
import { lineTotals, validateCoupon } from "@/lib/pricing";
import { normalizeStoredVariantAttributes } from "@/lib/product-attributes";
import { assertPaymentMethodAvailable, calculateDeliveryCharge, getBusinessSettings, getCourierCredential, getPaymentCredential } from "@/lib/settings";
import { getPaymentProvider } from "@/lib/payments/registry";
import { getCourierProvider } from "@/lib/couriers/registry";
import { notify, notifyOwners } from "@/lib/notifications";
import { sendServerPurchaseEvent } from "@/lib/marketing";
import { checkRateLimit } from "@/lib/rate-limit";
import { adjustStock } from "./inventory";

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
});

export type CheckoutInput = z.input<typeof checkoutSchema>;

export async function placeOrder(raw: CheckoutInput) {
  const input = checkoutSchema.parse(raw);
  // Server-side provider validation is mandatory: frontend visibility is never trusted.
  const method = await assertPaymentMethodAvailable(input.paymentMethod);
  if (input.ip) checkRateLimit(`order:${input.ip}:${input.customer.phone}`, 6, 10 * 60 * 1000);

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

  const duplicate = await prisma.order.findFirst({
    where: {
      customer: { phone: input.customer.phone },
      productId: product.id,
      createdAt: { gte: new Date(Date.now() - 15_000) },
    },
  });
  if (duplicate) throw new ConflictError("An order was just submitted. Please wait before repeating.");

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
    const customer = await tx.customer.upsert({
      where: { phone: input.customer.phone },
      create: {
        name: input.customer.name, phone: input.customer.phone,
        email: input.customer.email || null,
        addresses: { create: { address: input.customer.address, district: input.customer.district, area: input.customer.area ?? null } },
      },
      update: { name: input.customer.name, email: input.customer.email || null },
    });

    const created = await tx.order.create({
      data: {
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
        reservations: { create: { variantId: variant.id, quantity: input.quantity, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } },
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
      data: { action: "ORDER_PLACED", entity: "Order", entityId: created.id, after: { orderNumber: created.orderNumber, total: created.total, paymentMethod: input.paymentMethod } as never },
    });
    return created;
  });

  await notifyOwners("NEW_ORDER", "New order received", `${order.orderNumber} · ৳${order.total} · ${method.name}`);
  await notify({
    type: "ORDER_RECEIVED", title: "We received your order",
    body: `Order ${order.orderNumber} has been received. We will contact ${input.customer.name} to confirm it.`,
    customerId: (await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { customerId: true } })).customerId,
    orderId: order.id, email: input.customer.email || null, phone: input.customer.phone,
    channels: ["IN_APP", "EMAIL", "SMS"],
  });

  if (input.paymentMethod === "cod") {
    return { order, checkoutUrl: null as string | null };
  }

  const provider = getPaymentProvider(input.paymentMethod);
  if (!provider) throw new ConflictError("Unknown payment provider");
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  try {
    const credentials = await getPaymentCredential(input.paymentMethod);
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
    await prisma.$transaction([
      prisma.paymentTransaction.create({
        data: {
          orderId: order.id, provider: provider.code, reference: result.reference,
          status: "INITIATED", amount: order.total, currency: order.currency, sandbox: method.sandbox,
          checkoutUrl: result.checkoutUrl ?? null, payload: (result.raw ?? {}) as never,
        },
      }),
      prisma.paymentAttempt.create({
        data: { orderId: order.id, provider: provider.code, status: "INITIATED", response: (result.raw ?? {}) as never },
      }),
    ]);
    return { order, checkoutUrl: result.checkoutUrl ?? null };
  } catch (error) {
    // Provider failures must never leave deducted stock or a paid-looking order.
    await cancelOrderInternal(order.id, null, "Payment provider initialization failed");
    throw new ConflictError(error instanceof Error ? `Payment could not be started: ${error.message}` : "Payment could not be started");
  }
}

async function cancelOrderInternal(orderId: string, actorId: string | null, reason: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.status === "CANCELLED") return;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED", cancelledAt: new Date(), internalNote: reason },
    });
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: "CANCELLED", source: "SYSTEM", note: reason, createdById: actorId } });
    if (!["DELIVERED", "SHIPPED", "OUT_FOR_DELIVERY"].includes(order.status)) {
      for (const item of order.items) {
        if (!item.variantId) continue;
        await adjustStock(tx, {
          variantId: item.variantId, delta: item.quantity, type: "CANCELLATION",
          reason: `Cancelled ${order.orderNumber}`, reference: order.id, actorId,
        });
      }
    }
  });
}

export async function cancelOrder(orderId: string, actorId: string, reason: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order not found");
  if (["CANCELLED", "RETURNED", "DELIVERED"].includes(order.status)) throw new ConflictError("This order can no longer be cancelled");
  await cancelOrderInternal(orderId, actorId, reason);
  await audit({ actorId, action: "CANCEL_ORDER", entity: "Order", entityId: orderId, after: { status: "CANCELLED", reason } });
  await notify({
    type: "ORDER_CANCELLED", title: "Order cancelled", body: `Order ${order.orderNumber} was cancelled. ${reason}`,
    orderId, channels: ["IN_APP", "EMAIL", "SMS"],
  });
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending", CONFIRMED: "Confirmed", PROCESSING: "Processing", READY_TO_SHIP: "Ready to Ship",
  SHIPPED: "Shipped", OUT_FOR_DELIVERY: "Out for Delivery", DELIVERED: "Delivered",
  CANCELLED: "Cancelled", RETURNED: "Returned", FAILED_DELIVERY: "Failed Delivery",
};

export async function updateOrderStatus(orderId: string, status: OrderStatus, actorId: string, note?: string, source = "MANUAL") {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order not found");
  if (["CANCELLED", "RETURNED"].includes(order.status)) throw new ConflictError("This order is closed");
  if (order.status === status) return order;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.order.update({
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
    return result;
  });
  await audit({ actorId, action: "ORDER_STATUS_CHANGED", entity: "Order", entityId: orderId, before: { status: order.status }, after: { status } });
  await notify({
    type: `ORDER_${status}`, title: `Order ${STATUS_LABELS[status].toLowerCase()}`,
    body: `Order ${order.orderNumber} is now ${STATUS_LABELS[status]}.`,
    orderId, customerId: order.customerId, channels: ["IN_APP", "EMAIL", "SMS"],
  });
  return updated;
}

export async function processPaymentCallback(providerCode: string, payload: Record<string, unknown>) {
  const provider = getPaymentProvider(providerCode);
  if (!provider) throw new ConflictError("Unknown payment provider");
  const transactionRef = String(payload.paymentID ?? payload.tran_id ?? payload.tranId ?? payload.paymentRefId ?? payload.trxID ?? "");
  if (!transactionRef) throw new ConflictError("Callback is missing a transaction reference");
  const eventId = String(payload.val_id ?? payload.trxID ?? payload.paymentRefId ?? transactionRef);
  await prisma.webhookEvent.upsert({
    where: { provider_eventId: { provider: providerCode, eventId } },
    create: { provider: providerCode, eventId, payload: payload as never },
    update: {},
  });

  const config = await prisma.paymentMethodConfiguration.findUnique({ where: { code: providerCode } });
  if (!config?.enabled) throw new ConflictError("Payment provider is disabled");
  const credentials = await getPaymentCredential(providerCode);
  const verification = await provider.verify(payload, credentials, config.sandbox);
  const transaction = await prisma.paymentTransaction.findFirst({
    where: { provider: providerCode, OR: [{ reference: verification.reference }, { reference: transactionRef }] },
    include: { order: true },
  });
  if (!transaction) throw new NotFoundError("Unknown payment transaction");
  if (verification.amount && Math.abs(verification.amount - transaction.amount) > 0) {
    await prisma.paymentAttempt.create({ data: { orderId: transaction.orderId, provider: providerCode, status: "AMOUNT_MISMATCH", response: verification.raw as never } });
    throw new ConflictError("Payment amount does not match the order");
  }

  if (verification.status !== "PAID") {
    await prisma.paymentTransaction.update({ where: { id: transaction.id }, data: { status: "FAILED" } });
    await prisma.paymentAttempt.create({ data: { orderId: transaction.orderId, provider: providerCode, status: "FAILED", response: verification.raw as never } });
    return { ok: false, orderNumber: transaction.order.orderNumber };
  }

  if (transaction.verifiedAt) return { ok: true, duplicate: true, orderNumber: transaction.order.orderNumber };
  const claimed = await prisma.paymentTransaction.updateMany({
    where: { id: transaction.id, verifiedAt: null },
    data: { status: "PAID", verifiedAt: new Date(), payload: verification.raw as never },
  });
  if (claimed.count === 0) return { ok: true, duplicate: true, orderNumber: transaction.order.orderNumber };

  await prisma.$transaction([
    prisma.order.update({
      where: { id: transaction.orderId },
      data: {
        paymentStatus: "PAID", paymentReference: verification.reference,
        financialStatus: "SETTLED", settlementStatus: "SETTLED",
        status: transaction.order.status === "PENDING" ? "CONFIRMED" : transaction.order.status,
      },
    }),
    prisma.orderStatusHistory.create({
      data: { orderId: transaction.orderId, fromStatus: transaction.order.status, toStatus: transaction.order.status === "PENDING" ? "CONFIRMED" : transaction.order.status, source: "PAYMENT_PROVIDER", note: `Verified ${providerCode} payment ${verification.reference}` },
    }),
    prisma.auditLog.create({
      data: { action: "PAYMENT_VERIFIED", entity: "Order", entityId: transaction.orderId, after: { reference: verification.reference, provider: providerCode } as never },
    }),
  ]);
  await notifyOwners("PAYMENT_RECEIVED", "Payment received", `${transaction.order.orderNumber} · ${provider.name}`);
  await sendServerPurchaseEvent({
    name: "Purchase", orderId: transaction.orderId, value: transaction.amount,
    currency: transaction.currency, visitorId: "server", email: null, phone: null,
  });
  return { ok: true, duplicate: false, orderNumber: transaction.order.orderNumber };
}

export async function assignManualCourier(input: {
  orderId: string; courierName: string; consignmentId?: string; trackingId?: string;
  cost?: number; codAmount?: number; status?: string; note?: string;
}, actorId: string) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new NotFoundError("Order not found");
  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.courierShipment.create({
      data: {
        orderId: order.id, providerCode: "manual",
        consignmentId: input.consignmentId ?? null, trackingId: input.trackingId ?? null,
        status: (input.status as "BOOKED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "PENDING") ?? "BOOKED",
        cost: input.cost ?? 0, codAmount: input.codAmount ?? 0,
        payload: { courierName: input.courierName, note: input.note ?? null } as never,
        createdById: actorId,
      },
    });
    await tx.courierTrackingEvent.create({
      data: {
        shipmentId: created.id, status: created.status,
        description: `Manually assigned to ${input.courierName}${input.note ? ` — ${input.note}` : ""}`,
        source: "MANUAL",
      },
    });
    await tx.order.update({ where: { id: order.id }, data: { courierFee: input.cost ?? 0 } });
    return created;
  });
  await audit({ actorId, action: "MANUAL_COURIER_ASSIGN", entity: "CourierShipment", entityId: shipment.id, after: input as never });
  return shipment;
}

export async function bookCourierShipment(orderId: string, providerCode: string, actorId: string) {
  const config = await prisma.courierProviderConfiguration.findUnique({ where: { code: providerCode } });
  if (!config?.enabled) throw new ConflictError("This courier provider is disabled");
  const provider = getCourierProvider(providerCode);
  if (!provider) throw new ConflictError("Unknown courier provider");
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, product: true } });
  const credentials = await getCourierCredential(providerCode);
  if (!provider.credentialsValid(credentials)) throw new ConflictError("Courier credentials are not configured");
  let booking;
  try {
    booking = await provider.createShipment({
      orderNumber: order.orderNumber,
      customerName: await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId }, select: { name: true } }).then((c) => c.name),
      phone: (await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId }, select: { phone: true } })).phone,
      address: order.address, district: order.district, area: order.area,
      codAmount: order.paymentMethod === "cod" ? order.total : 0,
      weightGrams: order.product.weightGrams ?? 500,
      items: order.items.map((i) => i.name).join(", "),
      sandbox: config.sandbox,
      credentials,
    });
  } catch (error) {
    await prisma.courierProviderConfiguration.update({ where: { code: providerCode }, data: { lastError: error instanceof Error ? error.message : "Booking failed" } });
    throw new ConflictError(error instanceof Error ? error.message : "Courier booking failed");
  }
  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.courierShipment.create({
      data: {
        orderId, providerCode, consignmentId: booking.consignmentId, trackingId: booking.trackingId,
        trackingUrl: booking.trackingUrl ?? null, cost: booking.cost ?? 0,
        codAmount: order.paymentMethod === "cod" ? order.total : 0,
        status: "BOOKED", payload: booking.raw as never, createdById: actorId,
      },
    });
    await tx.courierTrackingEvent.create({ data: { shipmentId: created.id, status: "BOOKED", description: "Shipment booked via provider API", source: "API", raw: booking.raw as never } });
    await tx.order.update({ where: { id: orderId }, data: { courierFee: booking.cost ?? 0 } });
    return created;
  });
  await audit({ actorId, action: "COURIER_BOOKED", entity: "CourierShipment", entityId: shipment.id, after: { providerCode, trackingId: booking.trackingId } as never });
  return shipment;
}

export async function syncCourierTracking(shipmentId: string, actorId: string) {
  const shipment = await prisma.courierShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { order: true } });
  if (shipment.providerCode === "manual") throw new ConflictError("Manual shipments cannot be synced with an API");
  const provider = getCourierProvider(shipment.providerCode);
  if (!provider) throw new ConflictError("Unknown courier provider");
  const config = await prisma.courierProviderConfiguration.findUnique({ where: { code: shipment.providerCode } });
  if (!config?.enabled) throw new ConflictError("Courier provider is disabled");
  const credentials = await getCourierCredential(shipment.providerCode);
  const result = await provider.getTracking(shipment.trackingId ?? shipment.consignmentId ?? "", credentials, config.sandbox);
  await prisma.courierTrackingEvent.create({
    data: {
      shipmentId, status: (result.status as "PENDING" | "BOOKED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED") ?? "PENDING",
      description: result.description ?? null, eventAt: result.at ?? new Date(), source: "API", raw: result.raw as never,
    },
  });
  await audit({ actorId, action: "COURIER_SYNC", entity: "CourierShipment", entityId: shipmentId, after: { status: result.status } as never });
  return result;
}

export async function collectCod(orderId: string, amount: number, actorId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.paymentMethod !== "cod") throw new ConflictError("Order is not a COD order");
  if (amount < 0 || amount > order.total) throw new ConflictError("Invalid COD amount");
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { paymentStatus: "COD_COLLECTED", codCollectedAt: new Date(), financialStatus: amount >= order.total ? "PARTIALLY_SETTLED" : "UNSETTLED" },
  });
  await audit({ actorId, action: "COD_COLLECTED", entity: "Order", entityId: orderId, after: { amount } as never });
  return updated;
}

export async function settleCod(orderId: string, actorId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.paymentMethod !== "cod") throw new ConflictError("Order is not a COD order");
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { settlementStatus: "SETTLED", financialStatus: "SETTLED", codSettledAt: new Date() },
  });
  await audit({ actorId, action: "COD_SETTLED", entity: "Order", entityId: orderId });
  return updated;
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
      shipments: { include: { trackingEvents: { orderBy: { eventAt: "desc" } } } },
      payments: true, refunds: true, returns: true, redemptions: true,
      reviews: true,
    },
  });
}

/** Explicit allow-list: public tracking must never receive internal notes or full addresses. */
export async function getOrderByTrackingToken(token: string) {
  return prisma.order.findUnique({
    where: { trackingToken: token },
    select: {
      id: true, orderNumber: true, createdAt: true, status: true, total: true,
      paymentMethod: true, deliveryOption: true, expectedDeliveryAt: true, district: true, area: true,
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
