"use server";
import type { OrderStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  assignManualCourier, bookCourierShipment, cancelOrder, collectCod, expireEligibleReservations,
  settleCod, syncCourierTracking, updateOrderStatus,
} from "@/services/orders";
import { assignOwnDelivery, recordOwnDeliveryEvent } from "@/services/own-delivery";
import { reconcileCourierBooking, reconcileCourierCancellation, requestCourierCancellation } from "@/services/courier-operations";
import { bool, finish, num, str } from "./helpers";

function path(id: string) { return `/dashboard/orders/${id}`; }

export async function orderStatusAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => updateOrderStatus(id, str(formData, "status") as OrderStatus, user.id, str(formData, "note") || undefined), "Status updated");
}

export async function cancelOrderAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => cancelOrder(id, user.id, str(formData, "reason") || "Cancelled by staff"), "Cancellation recorded. Check stock, courier and payment reconciliation separately.");
}

export async function expireReservationsAction() {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  await finish("/dashboard/orders", async () => {
    const result = await expireEligibleReservations(user.id);
    if (result.deferred) console.warn("Some eligible reservation candidates need review", { deferred: result.deferred });
  }, "Eligible unpaid reservations processed; uncertain payments remain reserved");
}

export async function internalNoteAction(formData: FormData) {
  await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), async () => {
    await prisma.order.update({ where: { id }, data: { internalNote: str(formData, "internalNote") || null } });
  }, "Internal note saved");
}

export async function manualCourierAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => assignManualCourier({
    orderId: id, courierName: str(formData, "courierName"), consignmentId: str(formData, "consignmentId") || undefined,
    trackingId: str(formData, "trackingId") || undefined, cost: num(formData, "cost"),
    codAmount: num(formData, "codAmount"), status: str(formData, "status", "BOOKED"), note: str(formData, "note") || undefined,
  }, user.id), "Manual courier details saved");
}

export async function bookCourierAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => bookCourierShipment(id, str(formData, "provider"), user.id), "Shipment booked through provider");
}

export async function syncTrackingAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => syncCourierTracking(str(formData, "shipmentId"), user.id), "Tracking synchronized");
}

export async function assignOwnDeliveryAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => assignOwnDelivery({ orderId: id, personId: str(formData, "personId"),
    expectedPersonId: str(formData, "expectedPersonId") || undefined, note: str(formData, "note") || undefined }, user.id), "Shop delivery assigned");
}

export async function ownDeliveryEventAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => recordOwnDeliveryEvent({ orderId: id,
    status: str(formData, "status") as "DISPATCHED" | "OUT_FOR_DELIVERY" | "FAILED" | "DELIVERED" | "RETURNING" | "RETURNED" | "CANCELLED",
    note: str(formData, "note") || undefined }, user.id), "Physical delivery event recorded; stock has not been returned");
}

export async function reconcileCourierBookingAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), async () => {
    if (!bool(formData, "confirmOriginalAccount")) throw new Error("Confirm that the original provider account and environment were checked");
    const environment = str(formData, "environment");
    if (!["sandbox", "live"].includes(environment)) throw new Error("Choose the original provider environment");
    return reconcileCourierBooking({ shipmentId: str(formData, "shipmentId"), merchantReference: str(formData, "merchantReference"),
      consignmentId: str(formData, "consignmentId"), trackingId: str(formData, "trackingId"),
      sandbox: environment === "sandbox", evidence: str(formData, "evidence"), confirmOriginalAccount: true }, user.id);
  }, "Staff booking evidence recorded; goods are not automatically returned");
}

export async function requestCourierCancellationAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => requestCourierCancellation(str(formData, "shipmentId"), user.id),
    "Courier cancellation requires reconciliation. No stock was released.");
}

export async function reconcileCourierCancellationAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), async () => {
    if (!bool(formData, "confirmOriginalAccount")) throw new Error("Confirm that the original courier account was checked");
    return reconcileCourierCancellation({ shipmentId: str(formData, "shipmentId"),
      outcome: str(formData, "outcome") as "CANCELLED" | "NOT_CANCELLED", evidence: str(formData, "evidence"),
      confirmOriginalAccount: true }, user.id);
  }, "Staff courier outcome recorded; warehouse receipt is still required");
}

export async function collectCodAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => collectCod(id, num(formData, "amount"), user.id), "COD collection recorded");
}

export async function settleCodAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const id = str(formData, "id");
  await finish(path(id), () => settleCod(id, user.id), "COD settlement recorded");
}
