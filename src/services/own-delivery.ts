import { z } from "zod";
import type { OrderStatus, OwnDeliveryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { COURIER_BOOKING_ORDER_STATUSES, MANUAL_ORDER_TRANSITIONS, OWN_DELIVERY_TRANSITIONS } from "@/lib/order-lifecycle";
import { hasConflictingDispatchEvidence, lockOrder } from "./order-lock";
import { assertAllocatedForFulfillment } from "./orders";

const assignmentSchema = z.object({
  orderId: z.string().min(1),
  personId: z.string().min(1),
  // A reassignment must name the person shown when the form was loaded.
  expectedPersonId: z.string().optional(),
  note: z.string().trim().max(500).optional(),
});

/** The action boundary requires orders.write. Only active staff can be assigned. */
export async function assignOwnDelivery(raw: z.input<typeof assignmentSchema>, actorId: string) {
  const input = assignmentSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { items: true, reservations: true } });
    if (!COURIER_BOOKING_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictError("Shop delivery can only be assigned to a confirmed, unshipped order");
    }
    if (await tx.courierShipment.findFirst({ where: { orderId: order.id }, select: { id: true } })) {
      throw new ConflictError("A courier record already exists; reconcile it before assigning shop delivery");
    }
    await assertAllocatedForFulfillment(tx, order);
    // Deactivation and assignment are serialized on the staff row. Dispatch
    // checks again because staff may be deactivated after assignment.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${input.personId} AND "isActive" = true FOR SHARE
    `;
    if (!rows.length) throw new ConflictError("Choose an active staff member");
    const existing = await tx.ownDelivery.findUnique({ where: { orderId: order.id } });
    if (existing?.status === "ASSIGNED" && existing.personId === input.personId) return existing;
    if (existing && !["ASSIGNED", "CANCELLED"].includes(existing.status)) {
      throw new ConflictError("A dispatched shop delivery cannot be reassigned");
    }
    if (existing && await tx.ownDeliveryEvent.findFirst({ where: { deliveryId: existing.id,
      status: { in: ["DISPATCHED", "OUT_FOR_DELIVERY", "FAILED", "DELIVERED", "RETURNING", "RETURNED"] } }, select: { id: true } })) {
      throw new ConflictError("Prior shop dispatch evidence requires reconciliation before reassignment");
    }
    if (existing && input.expectedPersonId !== existing.personId) {
      throw new ConflictError("Delivery assignment changed. Reload before reassigning");
    }
    if (!existing && input.expectedPersonId) throw new ConflictError("Delivery assignment changed. Reload before assigning");
    const delivery = existing
      ? await tx.ownDelivery.update({ where: { id: existing.id }, data: { personId: input.personId, status: "ASSIGNED" } })
      : await tx.ownDelivery.create({ data: { orderId: order.id, personId: input.personId, status: "ASSIGNED" } });
    await tx.ownDeliveryEvent.create({ data: { deliveryId: delivery.id, status: "ASSIGNED", personId: input.personId,
      actorId, note: input.note || null } });
    await tx.auditLog.create({ data: { actorId, action: "OWN_DELIVERY_ASSIGNED", entity: "OwnDelivery", entityId: delivery.id,
      after: { orderId: order.id, personId: input.personId } } });
    return delivery;
  });
}

const eventSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["DISPATCHED", "OUT_FOR_DELIVERY", "FAILED", "DELIVERED", "RETURNING", "RETURNED", "CANCELLED"]),
  note: z.string().trim().max(500).optional(),
});

const orderStatusForDelivery: Partial<Record<OwnDeliveryStatus, OrderStatus>> = {
  DISPATCHED: "SHIPPED", OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY", FAILED: "FAILED_DELIVERY", DELIVERED: "DELIVERED",
};

/** Records a physical event; return-to-courier is not a warehouse receipt. */
export async function recordOwnDeliveryEvent(raw: z.input<typeof eventSchema>, actorId: string) {
  const input = eventSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { items: true, reservations: true } });
    const delivery = await tx.ownDelivery.findUnique({ where: { orderId: input.orderId } });
    if (!delivery) throw new NotFoundError("Shop delivery assignment not found");
    if (delivery.status === input.status) return delivery;
    if (!OWN_DELIVERY_TRANSITIONS[delivery.status].includes(input.status)) {
      throw new ConflictError(`Cannot change shop delivery from ${delivery.status} to ${input.status}`);
    }
    if (input.status === "CANCELLED" && (!COURIER_BOOKING_ORDER_STATUSES.includes(order.status)
      || await hasConflictingDispatchEvidence(tx, order)
      || await tx.courierShipment.findFirst({ where: { orderId: order.id }, select: { id: true } }))) {
      throw new ConflictError("Conflicting delivery history requires review before unassigning; do not assume the parcel is back");
    }
    if (input.status === "DISPATCHED") {
      if (["CANCELLED", "RETURNED"].includes(order.status)) throw new ConflictError("A closed order cannot be dispatched");
      if (await tx.ownDeliveryEvent.findFirst({ where: { deliveryId: delivery.id,
        status: { in: ["DISPATCHED", "OUT_FOR_DELIVERY", "FAILED", "DELIVERED", "RETURNING", "RETURNED"] } }, select: { id: true } })) {
        throw new ConflictError("Prior shop dispatch evidence requires reconciliation");
      }
      if (await tx.courierShipment.findFirst({ where: { orderId: order.id }, select: { id: true } })) {
        throw new ConflictError("A courier record conflicts with shop delivery");
      }
      const active = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${delivery.personId} AND "isActive" = true FOR SHARE
      `;
      if (!active.length) throw new ConflictError("Assigned staff is inactive; reassign before dispatch");
      await assertAllocatedForFulfillment(tx, order);
    }
    const mapped = orderStatusForDelivery[input.status];
    // After cancellation (or completed returns) record physical facts without
    // reopening the commercial order or changing stock.
    const updateOrder = mapped && !["CANCELLED", "RETURNED"].includes(order.status);
    if (updateOrder && order.status !== mapped && !MANUAL_ORDER_TRANSITIONS[order.status].includes(mapped)) {
      throw new ConflictError(`Cannot record ${input.status} while order is ${order.status}`);
    }
    const now = new Date();
    const updated = await tx.ownDelivery.update({ where: { id: delivery.id }, data: { status: input.status } });
    await tx.ownDeliveryEvent.create({ data: { deliveryId: delivery.id, status: input.status, personId: delivery.personId,
      actorId, note: input.note || null } });
    if (updateOrder && mapped && order.status !== mapped) {
      await tx.order.update({ where: { id: order.id }, data: {
        status: mapped,
        ...(mapped === "SHIPPED" ? { shippedAt: now } : {}),
        ...(mapped === "DELIVERED" ? { deliveredAt: now } : {}),
      } });
      await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: mapped,
        source: "OWN_DELIVERY", note: input.note || null, createdById: actorId } });
      if (mapped === "SHIPPED") await tx.stockReservation.updateMany({ where: { orderId: order.id, releasedAt: null }, data: { releasedAt: now } });
    }
    await tx.auditLog.create({ data: { actorId, action: "OWN_DELIVERY_EVENT", entity: "OwnDelivery", entityId: delivery.id,
      before: { status: delivery.status }, after: { orderId: order.id, status: input.status } } });
    return updated;
  });
}
