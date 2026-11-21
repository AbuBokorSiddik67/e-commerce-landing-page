import type { OrderStatus, Prisma } from "@prisma/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { CANCELLABLE_ORDER_STATUSES, UNRESOLVED_COURIER_STATUSES } from "@/lib/order-lifecycle";

/**
 * Every cooperating order lifecycle writer locks the order first, then any
 * return/payment/variant rows. Never hold this lock while calling a provider.
 */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
  `;
  if (!rows.length) throw new NotFoundError("Order not found");
}

/** Call only while holding this order's row lock. A legacy status alone is not provider proof. */
export async function hasUnresolvedCourier(tx: Prisma.TransactionClient, orderId: string) {
  return Boolean(await tx.courierShipment.findFirst({
    where: { orderId, status: { in: [...UNRESOLVED_COURIER_STATUSES] } }, select: { id: true },
  }));
}

export async function assertNoUnresolvedCourier(tx: Prisma.TransactionClient, orderId: string) {
  if (await hasUnresolvedCourier(tx, orderId)) {
    throw new ConflictError("A courier booking or shipment has an unresolved outcome; staff reconciliation is required");
  }
}

/**
 * Historical or imported records may contain dispatch evidence that conflicts
 * with their current status. Status alone is not proof that goods are in stock.
 * Call only with the order lock held; never invent or rewrite old history.
 */
export async function hasConflictingDispatchEvidence(tx: Prisma.TransactionClient, order: {
  id: string; status: OrderStatus; shippedAt: Date | null; deliveredAt: Date | null; cancelledAt: Date | null;
}) {
  if (!CANCELLABLE_ORDER_STATUSES.includes(order.status)) return false;
  if (order.shippedAt || order.deliveredAt || order.cancelledAt) return true;
  const dispatchedOrClosed: OrderStatus[] = ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY", "CANCELLED", "RETURNED"];
  const history = await tx.orderStatusHistory.findFirst({ where: { orderId: order.id, OR: [
    { toStatus: { in: dispatchedOrClosed } }, { fromStatus: { in: dispatchedOrClosed } },
  ] }, select: { id: true } });
  if (history) return true;
  const delivery = await tx.ownDelivery.findUnique({ where: { orderId: order.id }, select: { id: true } });
  if (delivery && await tx.ownDeliveryEvent.findFirst({ where: { deliveryId: delivery.id,
    status: { in: ["DISPATCHED", "OUT_FOR_DELIVERY", "FAILED", "DELIVERED", "RETURNING", "RETURNED"] } }, select: { id: true } })) return true;
  // Even a rejected historical return indicates that the order was treated as
  // dispatched. Its current pre-shipment status is therefore ambiguous.
  return Boolean(await tx.returnRequest.findFirst({ where: { orderId: order.id }, select: { id: true } }));
}

export async function assertNoConflictingDispatchEvidence(tx: Prisma.TransactionClient, order: {
  id: string; status: OrderStatus; shippedAt: Date | null; deliveredAt: Date | null; cancelledAt: Date | null;
}) {
  if (await hasConflictingDispatchEvidence(tx, order)) {
    throw new ConflictError("Prior dispatch or return evidence conflicts with this order status; staff reconciliation is required");
  }
}
