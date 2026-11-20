import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { RETURNABLE_ORDER_STATUSES, RETURN_TRANSITIONS } from "@/lib/order-lifecycle";
import { compareStableIds, exactVariantQuantities } from "@/lib/inventory-invariants";
import { adjustStock, hasRecordedOrderSale } from "./inventory";
import { assertNoUnresolvedCourier, lockOrder } from "./order-lock";

export const returnSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
  details: z.string().trim().max(2000).optional(),
  returnCharge: z.coerce.number().int().nonnegative().default(0),
});

function hasExactReturnRestoration(
  items: Array<{ variantId: string | null; quantity: number }>,
  movements: Array<{ variantId: string | null; quantity: number; type: string }>,
) {
  return movements.every((movement) => movement.type === "RETURN") && exactVariantQuantities(items, movements);
}

export async function createReturnRequest(raw: z.input<typeof returnSchema>, actorId: string) {
  const input = returnSchema.parse(raw);
  const { request, orderNumber } = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictError("Returns can only be requested for shipped or delivered orders");
    }
    await assertNoUnresolvedCourier(tx, order.id);
    // All requests are whole-order requests. A completed or otherwise existing
    // non-rejected request must not be followed by a second full restock.
    const existing = await tx.returnRequest.findFirst({ where: { orderId: order.id, status: { not: "REJECTED" } } });
    if (existing) throw new ConflictError("A return request already exists for this order");
    const request = await tx.returnRequest.create({
      data: { orderId: order.id, productId: order.productId, reason: input.reason,
        details: input.details ?? null, returnCharge: input.returnCharge },
    });
    await tx.auditLog.create({ data: { actorId, action: "CREATE_RETURN", entity: "ReturnRequest", entityId: request.id,
      after: { orderId: order.id, reason: input.reason } } });
    return { request, orderNumber: order.orderNumber };
  });
  try {
    const { notifyOwners } = await import("@/lib/notifications");
    await notifyOwners("RETURN_REQUESTED", "New return request", `${orderNumber}: ${input.reason}`);
  } catch (error) {
    console.error("Return request committed but notification failed", { orderId: input.orderId, error });
  }
  return request;
}

export async function updateReturnStatus(id: string, status: "APPROVED" | "REJECTED" | "IN_TRANSIT" | "INSPECTED" | "RESTOCKED" | "REFUNDED" | "COMPLETED", actorId: string, note?: string) {
  // This lookup only locates the order to lock. The request and order are read
  // again under the lock before any eligibility decision or write.
  const pointer = await prisma.returnRequest.findUnique({ where: { id }, select: { orderId: true } });
  if (!pointer) throw new NotFoundError("Return request not found");
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, pointer.orderId);
    await tx.$queryRaw`SELECT "id" FROM "ReturnRequest" WHERE "id" = ${id} FOR UPDATE`;
    const request = await tx.returnRequest.findUnique({ where: { id }, include: { order: { include: { items: true, refunds: true } } } });
    if (!request || request.orderId !== pointer.orderId) throw new NotFoundError("Return request not found");
    if (request.status === status && status !== "RESTOCKED") return request;
    if (request.status !== status && !RETURN_TRANSITIONS[request.status].includes(status)) {
      throw new ConflictError(`Cannot change return from ${request.status} to ${status}`);
    }
    if (!RETURNABLE_ORDER_STATUSES.includes(request.order.status)) {
      throw new ConflictError("The order is no longer eligible for a return");
    }
    // A legacy or in-flight courier claim may still represent an external
    // parcel. In particular, never restock it while the outcome is unknown.
    await assertNoUnresolvedCourier(tx, request.orderId);
    if (request.order.refunds.some((refund) => !["RECORDED", "REFUNDED"].includes(refund.status))) {
      throw new ConflictError("A refund outcome is unresolved; reconcile it before changing this return");
    }
    const priorRestorations = await tx.stockMovement.findMany({
      // Unknown legacy stock operations (including RELEASE) are ambiguous too.
      where: { reference: request.orderId, type: { not: "SALE" } },
      select: { variantId: true, quantity: true, type: true },
    });
    const exactReturn = hasExactReturnRestoration(request.order.items, priorRestorations);
    if (request.status === status) {
      if (!request.restock || !exactReturn) throw new ConflictError("Existing return restoration is ambiguous; staff reconciliation is required");
      return request;
    }
    if (status === "RESTOCKED") {
      if (!request.restock) throw new ConflictError("This return is not marked for restocking");
      if (priorRestorations.length) throw new ConflictError("A prior stock restoration exists; staff reconciliation is required");
      if (!request.order.items.length || request.order.items.some((item) => !item.variantId || !Number.isInteger(item.quantity) || item.quantity <= 0)
        || !(await hasRecordedOrderSale(tx, request.orderId, request.order.productId, request.order.items))) {
        throw new ConflictError("Order items and sale movements cannot be safely reconciled; staff review is required");
      }
      for (const item of [...request.order.items].sort((a, b) => compareStableIds(a.variantId ?? "", b.variantId ?? ""))) {
        await adjustStock(tx, { variantId: item.variantId!, delta: item.quantity, type: "RETURN",
          reason: `Return ${request.id}`, reference: request.orderId, actorId });
      }
    }
    if (status === "REFUNDED") {
      if (request.restock && (request.status !== "RESTOCKED" || !exactReturn)) {
        throw new ConflictError("Restock this return before recording its refund status");
      }
      if (!request.order.refunds.some((refund) => refund.amount > 0 && ["RECORDED", "REFUNDED"].includes(refund.status))) {
        throw new ConflictError("Record a refund before marking this return refunded");
      }
    }
    if (status === "COMPLETED" && request.restock && !exactReturn) {
      throw new ConflictError("Restock this return before completing it");
    }
    const updated = await tx.returnRequest.update({
      where: { id }, data: { status, inspectionNote: note ?? request.inspectionNote,
        resolvedAt: ["COMPLETED", "REJECTED"].includes(status) ? new Date() : null },
    });
    if (status === "COMPLETED") {
      await tx.order.update({ where: { id: request.orderId }, data: { status: "RETURNED" } });
      await tx.orderStatusHistory.create({ data: { orderId: request.orderId, fromStatus: request.order.status,
        toStatus: "RETURNED", source: "MANUAL", note: note ?? "Return completed", createdById: actorId } });
    }
    await tx.auditLog.create({ data: { actorId, action: "UPDATE_RETURN", entity: "ReturnRequest", entityId: id,
      before: { status: request.status }, after: { status } } });
    return updated;
  });
}

const refundInputSchema = z.object({
  orderId: z.string().min(1),
  transactionId: z.string().min(1).optional(),
  amount: z.number().int().positive().max(2_147_483_647),
  reason: z.string().trim().min(1).max(500),
  // The form retains this UUID on retries. A new key means a new operation.
  idempotencyKey: z.string().uuid(),
});
type RefundInput = z.input<typeof refundInputSchema>;
type ParsedRefundInput = z.output<typeof refundInputSchema>;
type RefundOrder = Prisma.OrderGetPayload<{ include: { payments: true; paymentAttempts: true; refunds: true } }>;
type RefundRecord = RefundOrder["refunds"][number];

// Use the existing primary key as the durable operation key. It is stable across
// processes, contains no customer data or credentials, and needs no migration.
function refundId(input: ParsedRefundInput) {
  return `refund_${createHash("sha256").update(JSON.stringify(["v1", input.orderId, input.idempotencyKey])).digest("hex")}`;
}

function exactRefundRetry(refund: RefundRecord, input: ParsedRefundInput, mode: "INTERNAL" | "PROVIDER") {
  if (refund.orderId !== input.orderId || refund.mode !== mode || refund.amount !== input.amount
    || refund.reason !== input.reason || refund.transactionId !== (input.transactionId ?? null)) {
    throw new ConflictError("This refund key was already used with different details");
  }
  return refund;
}

/** Called only with the order row locked. Unknown refunds reserve their amount and block new attempts. */
function refundableBalance(order: RefundOrder, input: ParsedRefundInput) {
  if (!Number.isSafeInteger(order.total) || order.total <= 0) throw new ConflictError("Order amount requires reconciliation");
  if (order.refunds.some((refund) => !Number.isSafeInteger(refund.amount) || refund.amount <= 0
    || !["RECORDED", "REFUNDED"].includes(refund.status))) {
    throw new ConflictError("A refund outcome is unresolved or invalid; reconcile it before another refund");
  }
  const alreadyRefunded = order.refunds.reduce((sum, refund) => sum + refund.amount, 0);
  if (!Number.isSafeInteger(alreadyRefunded) || alreadyRefunded + input.amount > order.total) {
    throw new ConflictError("Refund exceeds the paid order total");
  }
  if (order.paymentMethod === "cod") {
    if (input.transactionId || order.paymentStatus !== "COD_COLLECTED" || !order.codCollectedAt
      || order.paymentReference || order.payments.length || order.paymentAttempts.length
      || !["PARTIALLY_SETTLED", "SETTLED", "REFUNDED"].includes(order.financialStatus)) {
      throw new ConflictError("COD collection evidence requires reconciliation before a refund");
    }
  } else {
    const payment = order.payments.length === 1 ? order.payments[0] : undefined;
    if (order.paymentStatus !== "PAID" || !order.paymentReference || !payment || !payment.verifiedAt
      || !["PAID", "PAID_REQUIRES_RECONCILIATION"].includes(payment.status)
      || payment.reference !== order.paymentReference || payment.provider !== order.paymentMethod
      || payment.amount !== order.total || payment.currency !== order.currency
      || (input.transactionId && input.transactionId !== payment.id)
      || !["PARTIALLY_SETTLED", "SETTLED", "REFUNDED"].includes(order.financialStatus)) {
      throw new ConflictError("Verified payment evidence requires reconciliation before a refund");
    }
  }
  return alreadyRefunded;
}

/** Records a staff-reported internal refund; this never calls or asserts success at a provider. */
export async function recordRefund(raw: RefundInput, actorId: string) {
  const input = refundInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: {
      payments: true, paymentAttempts: true, refunds: true,
    } });
    const existing = order.refunds.find((refund) => refund.id === refundId(input));
    if (existing) return exactRefundRetry(existing, input, "INTERNAL");
    const alreadyRefunded = refundableBalance(order, input);
    const refund = await tx.refund.create({ data: {
      id: refundId(input), orderId: order.id, amount: input.amount, reason: input.reason,
      transactionId: input.transactionId ?? null, mode: "INTERNAL", status: "RECORDED", createdById: actorId,
    } });
    await tx.order.update({ where: { id: order.id }, data: {
      financialStatus: alreadyRefunded + input.amount === order.total ? "REFUNDED" : "PARTIALLY_SETTLED",
    } });
    await tx.auditLog.create({ data: { actorId, action: "RECORD_REFUND", entity: "Refund", entityId: refund.id,
      after: { orderId: order.id, amount: input.amount, mode: "INTERNAL" } } });
    return refund;
  });
}

/**
 * At-most-one local provider call per key, and no other refund while the result
 * is uncertain. The current adapters do not establish authoritative, idempotent
 * refund completion, so even a reported success requires provider reconciliation.
 * Claims never expire automatically and no database transaction spans network I/O.
 */
export async function executeProviderRefund(raw: RefundInput & { transactionId: string }, actorId: string) {
  const input = refundInputSchema.extend({ transactionId: z.string().min(1) }).parse(raw);
  const id = refundId(input);
  // A retry should not contact the provider even if credentials are now unavailable.
  const prior = await prisma.refund.findUnique({ where: { id } });
  if (prior) return exactRefundRetry(prior, input, "PROVIDER");
  const transaction = await prisma.paymentTransaction.findUnique({ where: { id: input.transactionId } });
  if (!transaction || transaction.orderId !== input.orderId) throw new NotFoundError("Payment transaction not found for this order");
  const provider = (await import("@/lib/payments/registry")).getPaymentProvider(transaction.provider);
  if (!provider?.refund) throw new ConflictError("This provider does not support refunds");
  const config = await prisma.paymentMethodConfiguration.findUnique({ where: { code: transaction.provider } });
  if (!config?.enabled || config.sandbox !== transaction.sandbox) {
    throw new ConflictError("Payment provider environment changed or is disabled; reconcile before refunding");
  }
  const credentials = await (await import("@/lib/settings")).getPaymentCredential(transaction.provider);
  if (!provider.credentialsValid(credentials)) throw new ConflictError("Payment provider credentials are not configured");

  const start = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: {
      payments: true, paymentAttempts: true, refunds: true,
    } });
    const existing = order.refunds.find((refund) => refund.id === id);
    if (existing) return { kind: "existing" as const, refund: exactRefundRetry(existing, input, "PROVIDER") };
    refundableBalance(order, input);
    const payment = order.payments.find((item) => item.id === input.transactionId);
    if (!payment || !payment.reference || payment.reference !== transaction.reference || payment.provider !== transaction.provider
      || payment.sandbox !== transaction.sandbox || payment.amount !== transaction.amount || payment.currency !== transaction.currency) {
      throw new ConflictError("Payment changed while preparing the refund; reconcile before retrying");
    }
    const refund = await tx.refund.create({ data: { id, orderId: input.orderId, transactionId: payment.id,
      amount: input.amount, reason: input.reason, mode: "PROVIDER", status: "AWAITING_PROVIDER", createdById: actorId } });
    await tx.auditLog.create({ data: { actorId, action: "PROVIDER_REFUND_CLAIMED", entity: "Refund", entityId: id,
      after: { orderId: input.orderId, transactionId: payment.id, amount: input.amount, provider: payment.provider, sandbox: payment.sandbox } } });
    return { kind: "claimed" as const, refund, payment };
  });
  if (start.kind === "existing") return start.refund;

  let reportedStatus: "REFUNDED" | "PENDING" | undefined;
  let reportedReference: string | undefined;
  try {
    const result = await provider.refund({ reference: start.payment.reference!, amount: input.amount, credentials,
      sandbox: start.payment.sandbox, reason: input.reason });
    if (!result || !["REFUNDED", "PENDING"].includes(result.status)) throw new Error("Unrecognized refund response");
    reportedStatus = result.status;
    if (typeof result.providerReference === "string" && result.providerReference.length <= 512) reportedReference = result.providerReference;
    return await prisma.$transaction(async (tx) => {
      await lockOrder(tx, input.orderId);
      const claim = await tx.refund.findUniqueOrThrow({ where: { id } });
      exactRefundRetry(claim, input, "PROVIDER");
      if (claim.status !== "AWAITING_PROVIDER") throw new ConflictError("Refund claim changed; reconcile with the provider");
      const updated = await tx.refund.update({ where: { id }, data: {
        // This is an unverified provider-reported identifier, not proof of payout.
        status: "RECONCILIATION_REQUIRED", providerReference: reportedReference ?? null,
      } });
      await tx.auditLog.create({ data: { actorId, action: "PROVIDER_REFUND_RECONCILIATION_REQUIRED", entity: "Refund", entityId: id,
        after: { orderId: input.orderId, provider: start.payment.provider, reportedStatus, reportedReference: reportedReference ?? null } } });
      return updated;
    });
  } catch (error) {
    try {
      await prisma.$transaction(async (tx) => {
        await lockOrder(tx, input.orderId);
        const claim = await tx.refund.findUnique({ where: { id } });
        if (!claim || claim.status !== "AWAITING_PROVIDER") return;
        exactRefundRetry(claim, input, "PROVIDER");
        await tx.refund.update({ where: { id }, data: {
          status: reportedStatus ? "RECONCILIATION_REQUIRED" : "OUTCOME_UNKNOWN", providerReference: reportedReference ?? null,
        } });
        await tx.auditLog.create({ data: { actorId, action: "PROVIDER_REFUND_RECONCILIATION_REQUIRED", entity: "Refund", entityId: id,
          after: { orderId: input.orderId, provider: start.payment.provider,
            reportedStatus: reportedStatus ?? null, reportedReference: reportedReference ?? null } } });
      });
    } catch (recordError) {
      console.error("Could not annotate unresolved provider refund", { orderId: input.orderId, refundId: id,
        errorType: recordError instanceof Error ? recordError.name : "UnknownError" });
    }
    console.error("Provider refund requires reconciliation", { orderId: input.orderId, refundId: id,
      errorType: error instanceof Error ? error.name : "UnknownError" });
    throw new ConflictError("The provider refund may have been sent. Do not retry with a new key; reconcile it with the provider.");
  }
}
