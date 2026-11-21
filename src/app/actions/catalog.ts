"use server";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createCoupon, updateCoupon } from "@/services/coupons";
import { moderateReview } from "@/services/reviews";
import { executeProviderRefund, recordRefund, updateReturnStatus, createReturnRequest, receiveReturnItems, inspectReturnReceipt } from "@/services/returns";
import { updateCustomer } from "@/services/customers";
import { uploadMedia } from "@/services/media";
import { bool, finish, num, optionalStr, str } from "./helpers";

function requiredQuantity(formData: FormData, field: string) {
  const value = str(formData, field).trim();
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field} must be a whole number`);
  return Number(value);
}

export async function saveCouponAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.COUPON_WRITE);
  const id = str(formData, "id");
  await finish("/dashboard/coupons", async () => {
    const input = {
      code: str(formData, "code"), type: str(formData, "type") as "PERCENTAGE" | "FIXED",
      value: num(formData, "value"), productId: optionalStr(formData, "productId"),
      minOrderValue: num(formData, "minOrderValue"), maxDiscount: optionalStr(formData, "maxDiscount") ? num(formData, "maxDiscount") : null,
      usageLimit: optionalStr(formData, "usageLimit") ? num(formData, "usageLimit") : null,
      firstOrderOnly: bool(formData, "firstOrderOnly"), isActive: bool(formData, "isActive"),
      expiresAt: optionalStr(formData, "expiresAt"), startsAt: optionalStr(formData, "startsAt"),
    };
    if (id) await updateCoupon(id, input, user.id);
    else await createCoupon(input, user.id);
  });
}

export async function moderateReviewAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.REVIEW_MODERATE);
  await finish("/dashboard/reviews", () => moderateReview(str(formData, "id"), str(formData, "status") as "APPROVED" | "REJECTED", user.id), "Review updated");
}

export async function returnStatusAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const orderId = str(formData, "orderId");
  await finish(`/dashboard/orders/${orderId}`, () => updateReturnStatus(
    str(formData, "id"), str(formData, "status") as "APPROVED" | "REJECTED" | "IN_TRANSIT" | "INSPECTED" | "RESTOCKED" | "REFUNDED" | "COMPLETED",
    user.id, str(formData, "note") || undefined,
  ), "Return updated");
}

export async function createReturnAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  const orderId = str(formData, "orderId");
  await finish(`/dashboard/orders/${orderId}`, () => createReturnRequest({
    orderId, reason: str(formData, "reason"), details: str(formData, "details"), returnCharge: num(formData, "returnCharge"),
  }, user.id), "Return request created");
}

export async function receiveReturnAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  await requirePermission(PERMISSIONS.INVENTORY_WRITE);
  const orderId = str(formData, "orderId");
  await finish(`/dashboard/orders/${orderId}`, () => receiveReturnItems({
    returnRequestId: str(formData, "returnRequestId"), orderItemId: str(formData, "orderItemId"),
    quantity: requiredQuantity(formData, "quantity"), idempotencyKey: str(formData, "idempotencyKey"),
  }, user.id), "Warehouse receipt recorded. Stock is unchanged until inspection.");
}

export async function inspectReturnAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ORDER_WRITE);
  await requirePermission(PERMISSIONS.INVENTORY_WRITE);
  const orderId = str(formData, "orderId");
  await finish(`/dashboard/orders/${orderId}`, () => inspectReturnReceipt({ receiptId: str(formData, "receiptId"),
    sellableQuantity: requiredQuantity(formData, "sellableQuantity"), damagedQuantity: requiredQuantity(formData, "damagedQuantity"),
    note: str(formData, "note") || undefined }, user.id), "Inspection recorded and inventory balances updated");
}

export async function recordRefundAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.REFUND_WRITE);
  await finish(`/dashboard/orders/${str(formData, "orderId")}`, () => recordRefund({
    orderId: str(formData, "orderId"), amount: num(formData, "amount"), reason: str(formData, "reason"),
    transactionId: optionalStr(formData, "transactionId") ?? undefined, idempotencyKey: str(formData, "idempotencyKey"),
  }, user.id), "Internal refund recorded (provider not contacted)");
}

export async function providerRefundAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.REFUND_WRITE);
  const orderId = str(formData, "orderId");
  await finish(`/dashboard/orders/${orderId}`, () => executeProviderRefund({
    orderId, transactionId: str(formData, "transactionId"), amount: num(formData, "amount"),
    reason: str(formData, "reason"), idempotencyKey: str(formData, "idempotencyKey"),
  }, user.id), "Provider refund requires reconciliation; do not retry with a new key");
}

export async function customerAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.CUSTOMER_WRITE);
  await finish(`/dashboard/customers/${str(formData, "id")}`, () => updateCustomer(str(formData, "id"), {
    name: str(formData, "name"), email: optionalStr(formData, "email"), notes: optionalStr(formData, "notes"),
    tags: str(formData, "tags").split(",").map((t) => t.trim()).filter(Boolean),
  }, user.id), "Customer updated");
}

export async function uploadMediaAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.MEDIA_WRITE);
  const file = formData.get("file");
  await finish("/dashboard/media", async () => {
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload");
    await uploadMedia(file, str(formData, "folder", "General"), str(formData, "alt"), user.id);
  }, "File uploaded");
}

export async function reviewVisibleAction(formData: FormData) {
  await requirePermission(PERMISSIONS.REVIEW_MODERATE);
  await finish("/dashboard/reviews", () => prisma.productReview.update({
    where: { id: str(formData, "id") }, data: { status: bool(formData, "approve") ? "APPROVED" : "REJECTED" },
  }), "Review updated");
}
