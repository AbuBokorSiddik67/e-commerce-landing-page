import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { adjustStock } from "./inventory";

export const returnSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
  details: z.string().trim().max(2000).optional(),
  returnCharge: z.coerce.number().int().nonnegative().default(0),
});

export async function createReturnRequest(raw: z.input<typeof returnSchema>, actorId: string) {
  const input = returnSchema.parse(raw);
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new NotFoundError("Order not found");
  if (!["DELIVERED", "OUT_FOR_DELIVERY", "SHIPPED"].includes(order.status)) {
    throw new ConflictError("Returns can only be requested for shipped or delivered orders");
  }
  const existing = await prisma.returnRequest.findFirst({ where: { orderId: order.id, status: { notIn: ["REJECTED", "COMPLETED"] } } });
  if (existing) throw new ConflictError("An open return request already exists for this order");
  const request = await prisma.returnRequest.create({
    data: {
      orderId: order.id, productId: order.productId, reason: input.reason,
      details: input.details ?? null, returnCharge: input.returnCharge,
    },
  });
  const { notifyOwners } = await import("@/lib/notifications");
  await notifyOwners("RETURN_REQUESTED", "New return request", `${order.orderNumber}: ${input.reason}`);
  await audit({ actorId, action: "CREATE_RETURN", entity: "ReturnRequest", entityId: request.id, after: request });
  return request;
}

export async function updateReturnStatus(id: string, status: "APPROVED" | "REJECTED" | "IN_TRANSIT" | "INSPECTED" | "RESTOCKED" | "REFUNDED" | "COMPLETED", actorId: string, note?: string) {
  const request = await prisma.returnRequest.findUnique({ where: { id }, include: { order: { include: { items: true } } } });
  if (!request) throw new NotFoundError("Return request not found");
  if (["COMPLETED", "REJECTED"].includes(request.status)) throw new ConflictError("This return request is closed");

  await prisma.$transaction(async (tx) => {
    if (status === "RESTOCKED" && request.restock && request.status !== "RESTOCKED") {
      for (const item of request.order.items) {
        if (!item.variantId) continue;
        await adjustStock(tx, {
          variantId: item.variantId, delta: item.quantity, type: "RETURN",
          reason: `Return ${request.id}`, reference: request.orderId, actorId,
        });
      }
    }
    await tx.returnRequest.update({
      where: { id },
      data: {
        status,
        inspectionNote: note ?? request.inspectionNote,
        resolvedAt: ["COMPLETED", "REJECTED", "REFUNDED"].includes(status) ? new Date() : null,
      },
    });
    if (status === "COMPLETED") {
      await tx.order.update({ where: { id: request.orderId }, data: { status: "RETURNED" } });
      await tx.orderStatusHistory.create({
        data: { orderId: request.orderId, fromStatus: request.order.status, toStatus: "RETURNED", source: "MANUAL", note: note ?? "Return completed", createdById: actorId },
      });
    }
  });
  await audit({ actorId, action: "UPDATE_RETURN", entity: "ReturnRequest", entityId: id, before: { status: request.status }, after: { status } });
  return prisma.returnRequest.findUniqueOrThrow({ where: { id } });
}

/** Records an internal refund. Never claims a provider refund was executed. */
export async function recordRefund(input: {
  orderId: string; amount: number; reason: string; transactionId?: string;
}, actorId: string) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, include: { refunds: true } });
  if (!order) throw new NotFoundError("Order not found");
  if (input.amount <= 0) throw new ConflictError("Refund amount must be positive");
  const alreadyRefunded = order.refunds.reduce((sum, refund) => sum + refund.amount, 0);
  if (alreadyRefunded + input.amount > order.total) throw new ConflictError("Refund exceeds the order total");
  const refund = await prisma.refund.create({
    data: {
      orderId: order.id, amount: input.amount, reason: input.reason,
      transactionId: input.transactionId ?? null, mode: "INTERNAL", status: "RECORDED",
      createdById: actorId,
    },
  });
  const totalAfter = alreadyRefunded + input.amount;
  await prisma.order.update({
    where: { id: order.id },
    data: { financialStatus: totalAfter >= order.total ? "REFUNDED" : "PARTIALLY_SETTLED" },
  });
  await audit({ actorId, action: "RECORD_REFUND", entity: "Refund", entityId: refund.id, after: refund });
  return refund;
}

/** Calls the provider's real refund API when available; records actual status. */
export async function executeProviderRefund(transactionId: string, amount: number, reason: string, actorId: string) {
  const transaction = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (!transaction.verifiedAt) throw new ConflictError("Only verified payments can be refunded through a provider");
  const provider = (await import("@/lib/payments/registry")).getPaymentProvider(transaction.provider);
  if (!provider?.refund) throw new ConflictError("This provider does not support refunds");
  const credentials = await (await import("@/lib/settings")).getPaymentCredential(transaction.provider);
  const result = await provider.refund({ reference: transaction.reference ?? "", amount, credentials, sandbox: transaction.sandbox, reason });
  const refund = await prisma.refund.create({
    data: {
      orderId: transaction.orderId, transactionId: transaction.id, amount, reason,
      status: result.status, providerReference: result.providerReference ?? null,
      mode: "PROVIDER", createdById: actorId,
    },
  });
  await audit({ actorId, action: "PROVIDER_REFUND", entity: "Refund", entityId: refund.id, after: { status: result.status } as never });
  return refund;
}
