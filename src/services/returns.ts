import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { RETURNABLE_ORDER_STATUSES, RETURN_TRANSITIONS } from "@/lib/order-lifecycle";
import { adjustStock, hasRecordedOrderSale, receiveDamagedStock } from "./inventory";
import { lockOrder } from "./order-lock";

export const returnSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
  details: z.string().trim().max(2000).optional(),
  returnCharge: z.coerce.number().int().nonnegative().default(0),
});

export async function createReturnRequest(raw: z.input<typeof returnSchema>, actorId: string) {
  const input = returnSchema.parse(raw);
  const { request, orderNumber } = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictError("Returns can only be requested for shipped, delivered or cancelled orders");
    }
    // Completed partial returns do not prevent another request for remaining
    // units. All receipts across all requests are capped under the order lock.
    const existing = await tx.returnRequest.findFirst({ where: { orderId: order.id,
      status: { notIn: ["REJECTED", "COMPLETED"] } } });
    if (existing) throw new ConflictError("An open return request already exists for this order");
    const request = await tx.returnRequest.create({ data: { orderId: order.id, productId: order.productId,
      reason: input.reason, details: input.details ?? null, returnCharge: input.returnCharge } });
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

const receiptSchema = z.object({
  returnRequestId: z.string().min(1),
  orderItemId: z.string().min(1),
  quantity: z.number().int().positive().max(2_147_483_647),
  idempotencyKey: z.string().uuid(),
});

function receiptId(orderId: string, key: string) {
  return `receipt_${createHash("sha256").update(JSON.stringify(["v1", orderId, key])).digest("hex")}`;
}

async function lockOrderItems(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "OrderItem" WHERE "orderId" = ${orderId} ORDER BY "id" FOR SHARE`;
}

/** Receipt records physical custody only. It does not change either stock balance. */
export async function receiveReturnItems(raw: z.input<typeof receiptSchema>, actorId: string) {
  const input = receiptSchema.parse(raw);
  const pointer = await prisma.returnRequest.findUnique({ where: { id: input.returnRequestId }, select: { orderId: true } });
  if (!pointer) throw new NotFoundError("Return request not found");
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, pointer.orderId);
    await lockOrderItems(tx, pointer.orderId);
    const id = receiptId(pointer.orderId, input.idempotencyKey);
    const existing = await tx.returnReceipt.findUnique({ where: { id } });
    if (existing) {
      if (existing.orderId !== pointer.orderId || existing.returnRequestId !== input.returnRequestId
        || existing.orderItemId !== input.orderItemId || existing.receivedQuantity !== input.quantity) {
        throw new ConflictError("This receipt key was already used with different details");
      }
      return existing;
    }
    const request = await tx.returnRequest.findUnique({ where: { id: input.returnRequestId }, include: { order: { include: { items: true } } } });
    if (!request || request.orderId !== pointer.orderId) throw new NotFoundError("Return request not found");
    if (!["APPROVED", "IN_TRANSIT"].includes(request.status) || !RETURNABLE_ORDER_STATUSES.includes(request.order.status)) {
      throw new ConflictError("Approve the open return before recording a warehouse receipt");
    }
    const item = request.order.items.find((row) => row.id === input.orderItemId);
    if (!item || !Number.isInteger(item.quantity) || item.quantity <= 0) throw new ConflictError("Order item requires review");
    const prior = await tx.returnReceipt.findMany({ where: { orderId: request.orderId, orderItemId: item.id },
      select: { receivedQuantity: true } });
    const total = prior.reduce((sum, row) => sum + row.receivedQuantity, 0);
    if (!Number.isSafeInteger(total) || prior.some((row) => !Number.isInteger(row.receivedQuantity) || row.receivedQuantity <= 0)
      || total + input.quantity > item.quantity) throw new ConflictError("Receipt exceeds the unreceived quantity for this order item");
    const receipt = await tx.returnReceipt.create({ data: { id, orderId: request.orderId, returnRequestId: request.id,
      orderItemId: item.id, receivedQuantity: input.quantity, receivedById: actorId } });
    await tx.auditLog.create({ data: { actorId, action: "RETURN_RECEIVED", entity: "ReturnReceipt", entityId: id,
      after: { orderId: request.orderId, returnRequestId: request.id, orderItemId: item.id, quantity: input.quantity } } });
    return receipt;
  });
}

const inspectionSchema = z.object({
  receiptId: z.string().min(1),
  sellableQuantity: z.number().int().nonnegative().max(2_147_483_647),
  damagedQuantity: z.number().int().nonnegative().max(2_147_483_647),
  note: z.string().trim().max(1000).optional(),
});

type ReturnOrderItem = { id: string; variantId: string | null; quantity: number };

/**
 * All non-sale order movements must be explained by inspected receipt lines.
 * Older whole-order restorations and ambiguous legacy stock activity fail
 * closed; no automatic historical repair or duplicate credit is attempted.
 */
async function checkedReceiptLedger(tx: Prisma.TransactionClient, orderId: string, productId: string, items: ReturnOrderItem[]) {
  if (!items.length || items.some((item) => !item.variantId || !Number.isInteger(item.quantity) || item.quantity <= 0)
    || !(await hasRecordedOrderSale(tx, orderId, productId, items))) {
    throw new ConflictError("Order items and sale movements require review before inspection");
  }
  const receipts = await tx.returnReceipt.findMany({ where: { orderId }, include: {
    returnRequest: { select: { orderId: true, status: true } },
  } });
  const receiptIds = receipts.map((receipt) => receipt.id);
  const movements = await tx.stockMovement.findMany({ where: { OR: [
    { reference: orderId, type: { not: "SALE" } },
    ...(receiptIds.length ? [{ returnReceiptId: { in: receiptIds } }] : []),
  ] }, select: { productId: true, variantId: true, quantity: true, type: true, bucket: true, returnReceiptId: true, reference: true } });
  const itemById = new Map(items.map((item) => [item.id, item]));
  const totals = new Map<string, number>();
  for (const receipt of receipts) {
    const item = itemById.get(receipt.orderItemId);
    if (!item || receipt.returnRequest.orderId !== orderId || receipt.returnRequest.status === "REJECTED"
      || !Number.isInteger(receipt.receivedQuantity) || receipt.receivedQuantity <= 0) {
      throw new ConflictError("Return receipt evidence is inconsistent; staff review is required");
    }
    const total = (totals.get(item.id) ?? 0) + receipt.receivedQuantity;
    if (!Number.isSafeInteger(total) || total > item.quantity) throw new ConflictError("Return receipts exceed the ordered quantity");
    totals.set(item.id, total);
    const linked = movements.filter((movement) => movement.returnReceiptId === receipt.id);
    if (!receipt.inspectedAt) {
      if (receipt.sellableQuantity !== null || receipt.damagedQuantity !== null || linked.length) {
        throw new ConflictError("Uninspected receipt has conflicting stock activity");
      }
      continue;
    }
    const sellable = receipt.sellableQuantity;
    const damaged = receipt.damagedQuantity;
    if (sellable === null || damaged === null || !Number.isInteger(sellable) || !Number.isInteger(damaged)
      || sellable < 0 || damaged < 0 || sellable + damaged !== receipt.receivedQuantity) {
      throw new ConflictError("Inspected receipt quantities are inconsistent");
    }
    const expected = [["SELLABLE", sellable], ["DAMAGED", damaged]] as const;
    for (const [bucket, quantity] of expected) {
      const matched = linked.filter((movement) => movement.bucket === bucket);
      if ((quantity === 0 && matched.length) || (quantity > 0 && (matched.length !== 1 || matched[0].quantity !== quantity))) {
        throw new ConflictError("Inspected receipt stock ledger is incomplete or duplicated");
      }
    }
    if (linked.some((movement) => movement.type !== "RETURN" || movement.reference !== orderId
      || movement.productId !== productId || movement.variantId !== item.variantId)) {
      throw new ConflictError("Return stock movement does not match its receipt");
    }
  }
  if (movements.some((movement) => !movement.returnReceiptId || !receiptIds.includes(movement.returnReceiptId))) {
    throw new ConflictError("Prior stock activity is not backed by an inspected receipt; staff review is required");
  }
  return { receipts, totals };
}

/** Inspection and both balance/ledger writes commit atomically under the order lock. */
export async function inspectReturnReceipt(raw: z.input<typeof inspectionSchema>, actorId: string) {
  const input = inspectionSchema.parse(raw);
  const pointer = await prisma.returnReceipt.findUnique({ where: { id: input.receiptId }, select: { orderId: true } });
  if (!pointer) throw new NotFoundError("Return receipt not found");
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, pointer.orderId);
    await lockOrderItems(tx, pointer.orderId);
    const receipt = await tx.returnReceipt.findUnique({ where: { id: input.receiptId }, include: {
      returnRequest: true, order: { include: { items: true } }, orderItem: true,
    } });
    if (!receipt || receipt.orderId !== pointer.orderId) throw new NotFoundError("Return receipt not found");
    if (receipt.inspectedAt) {
      if (receipt.sellableQuantity !== input.sellableQuantity || receipt.damagedQuantity !== input.damagedQuantity
        || (receipt.inspectionNote ?? "") !== (input.note ?? "")) {
        throw new ConflictError("This receipt was already inspected with different details");
      }
      await checkedReceiptLedger(tx, receipt.orderId, receipt.order.productId, receipt.order.items);
      return receipt;
    }
    if (!["APPROVED", "IN_TRANSIT"].includes(receipt.returnRequest.status)
      || !RETURNABLE_ORDER_STATUSES.includes(receipt.order.status)) throw new ConflictError("This return is not open for inspection");
    if (input.sellableQuantity + input.damagedQuantity !== receipt.receivedQuantity) {
      throw new ConflictError("Sellable and damaged quantities must equal the physical receipt");
    }
    if (!receipt.returnRequest.restock && input.sellableQuantity) {
      throw new ConflictError("This return is not marked for sellable restocking");
    }
    await checkedReceiptLedger(tx, receipt.orderId, receipt.order.productId, receipt.order.items);
    const variantId = receipt.orderItem.variantId;
    if (!variantId) throw new ConflictError("The ordered variant no longer exists; staff review is required");
    const updated = await tx.returnReceipt.update({ where: { id: receipt.id }, data: {
      sellableQuantity: input.sellableQuantity, damagedQuantity: input.damagedQuantity,
      inspectionNote: input.note || null, inspectedById: actorId, inspectedAt: new Date(),
    } });
    if (input.sellableQuantity) await adjustStock(tx, { variantId, delta: input.sellableQuantity, type: "RETURN",
      reason: `Inspected sellable return ${receipt.id}`, reference: receipt.orderId, returnReceiptId: receipt.id, actorId });
    if (input.damagedQuantity) await receiveDamagedStock(tx, { variantId, quantity: input.damagedQuantity,
      reference: receipt.orderId, returnReceiptId: receipt.id, actorId });
    await tx.auditLog.create({ data: { actorId, action: "RETURN_INSPECTED", entity: "ReturnReceipt", entityId: receipt.id,
      after: { orderId: receipt.orderId, sellable: input.sellableQuantity, damaged: input.damagedQuantity } } });
    return updated;
  });
}

export async function updateReturnStatus(id: string, status: "APPROVED" | "REJECTED" | "IN_TRANSIT" | "INSPECTED" | "RESTOCKED" | "REFUNDED" | "COMPLETED", actorId: string, note?: string) {
  const pointer = await prisma.returnRequest.findUnique({ where: { id }, select: { orderId: true } });
  if (!pointer) throw new NotFoundError("Return request not found");
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, pointer.orderId);
    await lockOrderItems(tx, pointer.orderId);
    await tx.$queryRaw`SELECT "id" FROM "ReturnRequest" WHERE "id" = ${id} FOR UPDATE`;
    const request = await tx.returnRequest.findUnique({ where: { id }, include: {
      order: { include: { items: true, refunds: true } }, receipts: true,
    } });
    if (!request || request.orderId !== pointer.orderId) throw new NotFoundError("Return request not found");
    if (request.status === status) return request;
    if (!RETURN_TRANSITIONS[request.status].includes(status)) {
      throw new ConflictError(`Cannot change return from ${request.status} to ${status}`);
    }
    if (!RETURNABLE_ORDER_STATUSES.includes(request.order.status)) throw new ConflictError("The order is no longer eligible for a return");
    if (status === "REJECTED" && request.receipts.length) throw new ConflictError("A received return cannot be rejected");
    let ledger: Awaited<ReturnType<typeof checkedReceiptLedger>> | undefined;
    if (["INSPECTED", "RESTOCKED", "REFUNDED", "COMPLETED"].includes(status)) {
      if (!request.receipts.length || request.receipts.some((receipt) => !receipt.inspectedAt)) {
        throw new ConflictError("Record and inspect every received item before advancing this return");
      }
      ledger = await checkedReceiptLedger(tx, request.orderId, request.order.productId, request.order.items);
    }
    if (status === "REFUNDED" && !request.order.refunds.some((refund) => refund.amount > 0 && ["RECORDED", "REFUNDED"].includes(refund.status))) {
      throw new ConflictError("Record a refund before marking this return refunded");
    }
    const updated = await tx.returnRequest.update({ where: { id }, data: { status,
      inspectionNote: note ?? request.inspectionNote, resolvedAt: ["COMPLETED", "REJECTED"].includes(status) ? new Date() : null } });
    // A partial return leaves the order status alone. Cancellation remains the
    // commercial status even once every physically returned unit is received.
    if (status === "COMPLETED" && request.order.status !== "CANCELLED" && ledger
      && request.order.items.every((item) => ledger!.totals.get(item.id) === item.quantity)
      && ledger.receipts.every((receipt) => Boolean(receipt.inspectedAt))) {
      await tx.order.update({ where: { id: request.orderId }, data: { status: "RETURNED" } });
      await tx.orderStatusHistory.create({ data: { orderId: request.orderId, fromStatus: request.order.status,
        toStatus: "RETURNED", source: "MANUAL", note: note ?? "All order items returned and inspected", createdById: actorId } });
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
