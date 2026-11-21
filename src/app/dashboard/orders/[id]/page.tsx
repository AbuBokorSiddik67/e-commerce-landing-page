import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { getOrderForAdmin, STATUS_LABELS } from "@/services/orders";
import { getBusinessSettings, getCourierConfigurations } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, maskPhone } from "@/lib/utils";
import { COURIER_BOOKING_ORDER_STATUSES, MANUAL_ORDER_TRANSITIONS, OWN_DELIVERY_TRANSITIONS, RETURNABLE_ORDER_STATUSES, RETURN_TRANSITIONS, UNRESOLVED_COURIER_STATUSES } from "@/lib/order-lifecycle";
import { conflictingCourierReferences, courierEvidenceLabel, staffCourierEvidence } from "@/lib/courier-evidence";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { assignOwnDeliveryAction, bookCourierAction, cancelOrderAction, collectCodAction, internalNoteAction, manualCourierAction, orderStatusAction, ownDeliveryEventAction, recordCourierRejectionAction, reconcileCourierBookingAction, reconcileCourierCancellationAction, requestCourierCancellationAction, settleCodAction, syncTrackingAction } from "@/app/actions/orders";
import { createReturnAction, inspectReturnAction, providerRefundAction, receiveReturnAction, recordRefundAction, returnStatusAction } from "@/app/actions/catalog";
import { RefundOperationKey } from "@/components/dashboard/RefundOperationKey";
import { ReturnOperationKey } from "@/components/dashboard/ReturnOperationKey";

export const dynamic = "force-dynamic";

export default async function OrderDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const viewer = await requirePageAccess(PERMISSIONS.ORDER_VIEW);
  const canWrite = viewer.permissions.has(PERMISSIONS.ORDER_WRITE);
  const canInspect = canWrite && viewer.permissions.has(PERMISSIONS.INVENTORY_WRITE);
  const canRefund = viewer.permissions.has(PERMISSIONS.REFUND_WRITE);
  const { id } = await params;
  const query = await searchParams;
  const [order, business, couriers, staff] = await Promise.all([
    getOrderForAdmin(id), getBusinessSettings(), getCourierConfigurations(),
    canWrite ? prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  if (!order) notFound();
  const activeCouriers = couriers.filter((c) => c.enabled && c.configured);
  const activePayment = order.payments[order.payments.length - 1];
  const unresolvedCourier = order.shipments.some((shipment) => UNRESOLVED_COURIER_STATUSES.includes(shipment.status));
  const canFulfill = !unresolvedCourier && order.refunds.length === 0
    && (order.paymentMethod === "cod" || (order.paymentStatus === "PAID" && order.payments.some((payment) => payment.status === "PAID" && payment.verifiedAt)))
    && order.returns.every((request) => request.status === "REJECTED");
  const ownDelivery = order.ownDelivery;
  const nextStatuses = canFulfill ? MANUAL_ORDER_TRANSITIONS[order.status].filter((status) =>
    !ownDelivery || ownDelivery.status === "CANCELLED" || !["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"].includes(status)) : [];
  const canBookCourier = canFulfill && COURIER_BOOKING_ORDER_STATUSES.includes(order.status) && order.shipments.length === 0
    && (!ownDelivery || ownDelivery.status === "CANCELLED");
  const receivedByItem = new Map<string, number>();
  for (const ret of order.returns) for (const receipt of ret.receipts) {
    receivedByItem.set(receipt.orderItemId, (receivedByItem.get(receipt.orderItemId) ?? 0) + receipt.receivedQuantity);
  }
  const hasRemainingItems = order.items.some((item) => (receivedByItem.get(item.id) ?? 0) < item.quantity);
  const canRequestReturn = RETURNABLE_ORDER_STATUSES.includes(order.status) && !order.cancellationStockReleasedAt && hasRemainingItems
    && order.returns.every((request) => ["REJECTED", "COMPLETED"].includes(request.status));

  return (
    <>
      <PageHeader title={order.orderNumber} description={`Placed ${formatDate(order.createdAt)} · ${order.customer.name}`} action={<><Link href="/dashboard/orders" className="btn-secondary">Back to orders</Link><Link href={`/dashboard/orders/${id}/invoice`} target="_blank" className="btn-secondary"><Printer size={16} />Invoice</Link></>} />
      <Alert error={query.error} success={query.success} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">Items & totals</h2><p className="mt-1 text-xs text-ink-500">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</p></div><Badge tone={order.status === "DELIVERED" ? "success" : order.status === "CANCELLED" ? "danger" : "info"}>{STATUS_LABELS[order.status]}</Badge></div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="flex justify-between rounded-lg bg-ink-50 p-3"><dt className="text-ink-500">Subtotal</dt><dd>{formatMoney(order.subtotal)}</dd></div><div className="flex justify-between rounded-lg bg-ink-50 p-3"><dt className="text-ink-500">Delivery charge</dt><dd>{formatMoney(order.deliveryCharge)}</dd></div><div className="flex justify-between rounded-lg bg-ink-50 p-3"><dt className="text-ink-500">Discount</dt><dd>−{formatMoney(order.discount)}</dd></div><div className="flex justify-between rounded-lg bg-brand-50 p-3"><dt className="font-semibold">Total</dt><dd className="font-semibold">{formatMoney(order.total)}</dd></div></dl>
            <div className="mt-4 grid gap-2 text-xs text-ink-500 sm:grid-cols-2"><p>Payment: {order.paymentMethod} · {order.paymentStatus}</p><p>Financial: {order.financialStatus} · Settlement: {order.settlementStatus}</p><p>Delivery: {order.deliveryOption.replace("_", " ")} · Courier fee: {formatMoney(order.courierFee)}</p><p>Coupon: {order.couponCode ?? "none"} · Source: {order.source}</p></div>
          </Card>

          <Card className="p-6"><h2 className="font-semibold">Customer</h2><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><p><span className="text-ink-500">Name:</span> {order.customer.name}</p><p><span className="text-ink-500">Phone:</span> {maskPhone(order.customer.phone)}</p><p><span className="text-ink-500">Email:</span> {order.customer.email ?? "—"}</p><p><span className="text-ink-500">District:</span> {order.district}{order.area ? `, ${order.area}` : ""}</p><p className="sm:col-span-2"><span className="text-ink-500">Address:</span> {order.address}</p>{order.customerNote && <p className="sm:col-span-2"><span className="text-ink-500">Customer note:</span> {order.customerNote}</p>}</div><div className="mt-4"><Link href={`/dashboard/customers/${order.customerId}`} className="text-sm font-semibold text-brand-700 underline">View customer profile</Link></div></Card>

          <Card className="p-6"><h2 className="font-semibold">Status timeline</h2><ol className="mt-4">{order.statusHistory.map((event) => <li key={event.id} className="flex gap-4 border-l-2 border-ink-100 py-2 pl-4"><div><p className="text-sm font-medium">{STATUS_LABELS[event.toStatus]} <span className="text-xs text-ink-400">· {event.source}</span></p><p className="text-xs text-ink-500">{formatDate(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}{event.note ? ` · ${event.note}` : ""}</p></div></li>)}</ol>
            {canWrite && nextStatuses.length > 0 && <form action={orderStatusAction} className="mt-5 grid gap-3 border-t border-ink-100 pt-5 sm:grid-cols-[1fr_1fr_auto]"><input type="hidden" name="id" value={order.id} /><select className="input" name="status">{nextStatuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select><input className="input" name="note" placeholder="Note (optional)" /><button className="btn-primary">Update status</button></form>}
            {!canFulfill && order.status === "PENDING" && !unresolvedCourier && <p className="mt-3 text-xs text-amber-700">Online payment must be verified and stock allocated before fulfillment.</p>}
            {unresolvedCourier && <p className="mt-3 text-xs text-amber-700">A courier outcome is unresolved. Do not retry or assume stock is back. Use provider evidence and the reconciliation controls below.</p>}
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold">Shipping & courier</h2>
            {order.shipments.length ? <div className="mt-4 space-y-4">{order.shipments.map((shipment) => {
              const cancellation = shipment.operations.find((operation) => operation.kind === "CANCEL");
              const conflicts = conflictingCourierReferences(shipment.payload);
              return <div key={shipment.id} className="rounded-xl border border-ink-100 p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-sm font-semibold">{shipment.providerCode === "manual" ? ((shipment.payload as { courierName?: string })?.courierName ?? "Manual courier") : shipment.providerCode} · {shipment.status}</p>
                  <Badge tone={shipment.providerCode === "manual" ? "neutral" : "info"}>{shipment.providerCode === "manual" ? "Manual entry" : "Provider API"}</Badge>
                </div>
                <p className="mt-2 text-xs font-medium text-amber-700">{courierEvidenceLabel(shipment)}</p>
                <p className="mt-1 text-xs text-ink-500">Consignment: {shipment.consignmentId ?? "—"} · Tracking: {shipment.trackingId ?? "—"} · Fee: {formatMoney(shipment.cost)}</p>
                {conflicts.map((conflict, index) => <p key={index} className="mt-1 text-xs text-red-700">Conflicting provider report: consignment {conflict.consignment} · tracking {conflict.tracking}</p>)}
                {shipment.trackingUrl && <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 underline">Tracking link</a>}
                <div className="mt-3 space-y-1">{shipment.trackingEvents.map((event) => {
                  const evidence = event.source === "STAFF_RECONCILIATION" ? staffCourierEvidence(event.raw) : null;
                  return <p key={event.id} className="text-xs text-ink-500">{formatDate(event.eventAt)} · {event.status} · {event.description ?? "—"} ({event.source}){evidence ? ` · Evidence: ${evidence}` : ""}</p>;
                })}</div>
                {cancellation && <p className="mt-3 text-xs text-amber-700">Courier cancellation: {cancellation.status}{cancellation.outcome ? ` · ${cancellation.outcome}` : ""}. This never proves warehouse receipt.</p>}
                {canWrite && shipment.providerCode !== "manual" && shipment.status !== "PENDING" && (shipment.trackingId || shipment.consignmentId) && <form action={syncTrackingAction} className="mt-3"><input type="hidden" name="id" value={order.id} /><input type="hidden" name="shipmentId" value={shipment.id} /><button className="btn-secondary px-3 py-1.5">Sync tracking</button></form>}
                {canWrite && shipment.providerCode !== "manual" && shipment.status === "PENDING" && <form action={reconcileCourierBookingAction} className="mt-4 space-y-2 border-t border-ink-100 pt-4">
                  <h3 className="text-sm font-semibold">Record a known provider booking</h3>
                  <p className="text-xs text-amber-700">First check the original provider account and environment. An empty lookup or elapsed time does not prove a booking was never created; unknown claims must not be retried.</p>
                  <input type="hidden" name="id" value={order.id} /><input type="hidden" name="shipmentId" value={shipment.id} />
                  <input className="input" name="merchantReference" defaultValue={order.orderNumber} placeholder="Merchant order reference" required />
                  <div className="grid gap-2 sm:grid-cols-2"><input className="input" name="consignmentId" defaultValue={shipment.consignmentId ?? ""} placeholder="Provider consignment ID" required /><input className="input" name="trackingId" defaultValue={shipment.trackingId ?? ""} placeholder="Provider tracking ID" required /></div>
                  <select className="input" name="environment" defaultValue="" required><option value="">Original environment…</option><option value="sandbox">Sandbox</option><option value="live">Live</option></select>
                  <textarea className="textarea" name="evidence" minLength={20} placeholder="Provider portal evidence or support case (no credentials)" required />
                  <label className="flex gap-2 text-xs text-ink-600"><input type="checkbox" name="confirmOriginalAccount" required /> I checked the original account, environment, order and all reported parcels.</label>
                  <button className="btn-secondary">Record staff-reported booking</button>
                </form>}
                {canWrite && shipment.providerCode !== "manual" && shipment.status === "PENDING" && <form action={recordCourierRejectionAction} className="mt-4 space-y-2 border-t border-ink-100 pt-4">
                  <h3 className="text-sm font-semibold">Record a reported provider rejection</h3>
                  <p className="text-xs text-amber-700">Only record a request-specific rejection from the original account. An empty lookup or elapsed time is not rejection. This report does not clear the claim, allow a retry, or release stock.</p>
                  <input type="hidden" name="id" value={order.id} /><input type="hidden" name="shipmentId" value={shipment.id} />
                  <input className="input" name="merchantReference" defaultValue={order.orderNumber} placeholder="Merchant order reference" required />
                  <select className="input" name="environment" defaultValue="" required><option value="">Original environment…</option><option value="sandbox">Sandbox</option><option value="live">Live</option></select>
                  <textarea className="textarea" name="evidence" minLength={20} placeholder="Exact rejection and provider case evidence (no credentials)" required />
                  <label className="flex gap-2 text-xs text-ink-600"><input type="checkbox" name="confirmOriginalAccount" required /> I checked the original account, environment and merchant reference.</label>
                  <label className="flex gap-2 text-xs text-ink-600"><input type="checkbox" name="confirmDefinitiveRejection" required /> The provider explicitly rejected this request; this is not just an empty search.</label>
                  <button className="btn-secondary">Record rejection report</button>
                </form>}
                {canWrite && order.status === "CANCELLED" && shipment.status !== "PENDING" && <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
                  {shipment.providerCode !== "manual" && !cancellation && shipment.status !== "DELIVERED" && shipment.status !== "CANCELLED" && <form action={requestCourierCancellationAction}><input type="hidden" name="id" value={order.id} /><input type="hidden" name="shipmentId" value={shipment.id} /><button className="btn-secondary">Request courier cancellation once</button><p className="mt-1 text-xs text-amber-700">The provider may not support cancellation. A timeout is unknown and is never retried automatically.</p></form>}
                  {cancellation?.status !== "RECONCILED" && <form action={reconcileCourierCancellationAction} className="space-y-2">
                    <h3 className="text-sm font-semibold">Record courier cancellation evidence</h3>
                    <input type="hidden" name="id" value={order.id} /><input type="hidden" name="shipmentId" value={shipment.id} />
                    <select className="input" name="outcome"><option value="CANCELLED">Provider says cancelled</option><option value="NOT_CANCELLED">Provider says not cancelled</option></select>
                    <textarea className="textarea" name="evidence" minLength={20} placeholder="Account, provider response or support case (no credentials)" required />
                    <label className="flex gap-2 text-xs text-ink-600"><input type="checkbox" name="confirmOriginalAccount" required /> I checked the original courier account and this shipment.</label>
                    <button className="btn-secondary">Record staff-reported outcome</button>
                  </form>}
                </div>}
              </div>;
            })}</div> : <p className="mt-2 text-sm text-ink-500">No third-party shipment assigned.</p>}
            {canWrite && canBookCourier ? <div className="mt-5 grid gap-5 border-t border-ink-100 pt-5 lg:grid-cols-2">
              <form action={manualCourierAction} className="space-y-3"><h3 className="text-sm font-semibold">Record third-party courier manually</h3><input type="hidden" name="id" value={order.id} /><input className="input" name="courierName" placeholder="Courier name" required /><div className="grid grid-cols-2 gap-2"><input className="input" name="consignmentId" placeholder="Consignment ID" /><input className="input" name="trackingId" placeholder="Tracking ID" /></div><div className="grid grid-cols-2 gap-2"><input className="input" type="number" name="cost" placeholder="Courier fee" /><input className="input" type="number" name="codAmount" placeholder="COD amount" defaultValue={order.paymentMethod === "cod" && order.paymentStatus === "COD_PENDING" ? order.total : 0} /></div><select className="input" name="status"><option value="BOOKED">Booked</option><option value="IN_TRANSIT">In transit</option><option value="OUT_FOR_DELIVERY">Out for delivery</option><option value="DELIVERED">Delivered</option></select><input className="input" name="note" placeholder="Note" /><button className="btn-primary w-full">Save manual shipment</button></form>
              <form action={bookCourierAction} className="space-y-3"><h3 className="text-sm font-semibold">Book via enabled provider</h3><input type="hidden" name="id" value={order.id} /><select className="input" name="provider" required><option value="">Choose provider…</option>{activeCouriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select><button className="btn-secondary w-full" disabled={!activeCouriers.length}>Book shipment via API</button>{!activeCouriers.length && <p className="text-xs text-ink-400">No courier API is configured. Manual and shop delivery remain available.</p>}</form>
            </div> : <p className="mt-4 text-xs text-ink-500">Booking is available only for confirmed, allocated, unshipped orders without another delivery assignment or courier record.</p>}
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold">Shop delivery</h2>
            {ownDelivery ? <div className="mt-3 rounded-xl border border-ink-100 p-4">
              <p className="text-sm font-semibold">{ownDelivery.person.name} · {ownDelivery.status.replaceAll("_", " ")}{!ownDelivery.person.isActive ? " · inactive" : ""}</p>
              <div className="mt-3 space-y-1">{ownDelivery.events.map((event) => <p key={event.id} className="text-xs text-ink-500">{formatDate(event.createdAt)} · {event.status.replaceAll("_", " ")} · {event.person?.name ?? "Unknown staff"}{event.actor ? ` · by ${event.actor.name}` : ""}{event.note ? ` · ${event.note}` : ""}</p>)}</div>
              {ownDelivery.status === "ASSIGNED" && order.status === "CANCELLED" && <p className="mt-3 text-xs text-amber-700">This assignment could not be safely closed automatically. Review its delivery and courier history; do not dispatch or assume the parcel is back.</p>}
              {canWrite && !(ownDelivery.status === "ASSIGNED" && order.status === "CANCELLED") && OWN_DELIVERY_TRANSITIONS[ownDelivery.status].length > 0 && <form action={ownDeliveryEventAction} className="mt-4 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={order.id} />
                <select className="input w-auto" name="status">{OWN_DELIVERY_TRANSITIONS[ownDelivery.status].map((status) => <option key={status} value={status}>{status === "CANCELLED" ? "Unassign before dispatch" : status.replaceAll("_", " ")}</option>)}</select>
                <input className="input w-auto" name="note" placeholder="Event note" /><button className="btn-secondary">Record physical event</button>
              </form>}
            </div> : <p className="mt-2 text-sm text-ink-500">No shop delivery person assigned.</p>}
            {canWrite && canFulfill && COURIER_BOOKING_ORDER_STATUSES.includes(order.status) && order.shipments.length === 0
              && (!ownDelivery || ["ASSIGNED", "CANCELLED"].includes(ownDelivery.status)) && <form action={assignOwnDeliveryAction} className="mt-4 space-y-2 border-t border-ink-100 pt-4">
              <input type="hidden" name="id" value={order.id} /><input type="hidden" name="expectedPersonId" value={ownDelivery?.personId ?? ""} />
              <select className="input" name="personId" defaultValue={ownDelivery?.personId ?? ""} required><option value="">Choose active staff…</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
              <input className="input" name="note" placeholder="Assignment note (optional)" /><button className="btn-secondary">{ownDelivery?.status === "ASSIGNED" ? "Reassign delivery" : "Assign shop delivery"}</button>
            </form>}
            {ownDelivery?.status === "ASSIGNED" && order.status === "CONFIRMED" && <p className="mt-3 text-xs text-amber-700">Move the order to Processing or Ready to Ship before dispatch.</p>}
            <p className="mt-3 text-xs text-ink-500">Delivery events record what happened. A reported return does not add inventory; the warehouse must receive and inspect it below.</p>
          </Card>

          <Card className="p-6"><h2 className="font-semibold">Returns & refunds</h2>
            <p className="mt-2 text-xs text-ink-500">Receive physical units first. Inspection posts the sellable and damaged quantities separately; a courier status alone never increases stock.</p>
            {canWrite && canRequestReturn && <form action={createReturnAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><input type="hidden" name="orderId" value={order.id} /><input className="input" name="reason" placeholder="Return reason" minLength={5} required /><button className="btn-secondary">Create return request</button></form>}
            {order.returns.map((ret) => {
              const allInspected = ret.receipts.length > 0 && ret.receipts.every((receipt) => Boolean(receipt.inspectedAt));
              const next = RETURN_TRANSITIONS[ret.status].filter((status) =>
                !(status === "REJECTED" && ret.receipts.length > 0)
                && !(["INSPECTED", "RESTOCKED", "REFUNDED", "COMPLETED"].includes(status) && !allInspected));
              const receiving = ["APPROVED", "IN_TRANSIT"].includes(ret.status);
              return <div key={ret.id} className="mt-4 rounded-xl border border-ink-100 p-4">
                <p className="text-sm font-semibold">{ret.status} · {ret.reason}</p>
                <p className="text-xs text-ink-500">{formatDate(ret.createdAt)} · Sellable restocking: {ret.restock ? "allowed" : "not allowed"} · Return charge: {formatMoney(ret.returnCharge)}</p>
                {ret.receipts.length === 0 && ["INSPECTED", "RESTOCKED", "REFUNDED", "COMPLETED"].includes(ret.status) && <p className="mt-2 text-xs text-amber-700">This historical return has no item-level receipt evidence. Do not assume its stock movements are safe to repeat.</p>}
                {ret.receipts.map((receipt) => <div key={receipt.id} className="mt-3 rounded-lg bg-ink-50 p-3">
                  <p className="text-sm font-medium">{receipt.orderItem.name} · received {receipt.receivedQuantity}</p>
                  <p className="text-xs text-ink-500">{formatDate(receipt.createdAt)} · received by {receipt.receivedBy?.name ?? "unknown"}</p>
                  {receipt.inspectedAt ? <p className="mt-1 text-xs text-ink-600">Inspected: {receipt.sellableQuantity} sellable, {receipt.damagedQuantity} damaged · {receipt.inspectedBy?.name ?? "unknown"}{receipt.inspectionNote ? ` · ${receipt.inspectionNote}` : ""}</p>
                    : <p className="mt-1 text-xs text-amber-700">Awaiting inspection; no inventory credited.</p>}
                  {canInspect && receiving && !receipt.inspectedAt && <form action={inspectReturnAction} className="mt-3 space-y-2">
                    <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="receiptId" value={receipt.id} />
                    <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-ink-600">Sellable units<input className="input mt-1" type="number" name="sellableQuantity" min={0} max={receipt.receivedQuantity} step={1} defaultValue={0} required /></label><label className="text-xs text-ink-600">Damaged units<input className="input mt-1" type="number" name="damagedQuantity" min={0} max={receipt.receivedQuantity} step={1} defaultValue={0} required /></label></div>
                    <input className="input" name="note" placeholder="Condition / inspection note" />
                    <button className="btn-secondary">Post inspection</button><p className="text-xs text-ink-500">The two quantities must add up to the received quantity. This posting cannot be repeated with a different split.</p>
                  </form>}
                </div>)}
                {canInspect && receiving && order.items.map((item) => {
                  const remaining = item.quantity - (receivedByItem.get(item.id) ?? 0);
                  if (remaining <= 0) return null;
                  return <form key={item.id} action={receiveReturnAction} className="mt-3 space-y-2 border-t border-ink-100 pt-3">
                    <h3 className="text-sm font-semibold">Receive {item.name} · {remaining} not yet received</h3>
                    <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="returnRequestId" value={ret.id} /><input type="hidden" name="orderItemId" value={item.id} />
                    <label className="text-xs text-ink-600">Quantity physically received<input className="input mt-1" type="number" name="quantity" min={1} max={remaining} step={1} required /></label>
                    <ReturnOperationKey returnRequestId={ret.id} orderItemId={item.id} /><button className="btn-secondary">Record receipt</button>
                  </form>;
                })}
                {canWrite && next.length > 0 && <form action={returnStatusAction} className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3"><input type="hidden" name="id" value={ret.id} /><input type="hidden" name="orderId" value={order.id} /><select className="input w-auto" name="status">{next.map((status) => <option key={status} value={status}>{status}</option>)}</select><input className="input w-auto" name="note" placeholder="Status note" /><button className="btn-secondary">Update return status</button></form>}
              </div>;
            })}
            {canRefund && <div className="mt-5 grid gap-5 border-t border-ink-100 pt-5 lg:grid-cols-2"><form action={recordRefundAction} className="space-y-3"><h3 className="text-sm font-semibold">Record internal refund</h3><input type="hidden" name="orderId" value={order.id} /><RefundOperationKey orderId={order.id} mode="internal" /><input className="input" type="number" name="amount" min={1} step={1} placeholder="Amount" required /><input className="input" name="reason" placeholder="Reason" required /><button className="btn-secondary w-full">Record refund (no provider call)</button></form><form action={providerRefundAction} className="space-y-3"><h3 className="text-sm font-semibold">Refund via payment provider</h3><input type="hidden" name="orderId" value={order.id} /><RefundOperationKey orderId={order.id} mode="provider" /><select className="input" name="transactionId" required><option value="">Choose verified transaction…</option>{order.payments.filter((p) => p.verifiedAt).map((p) => <option key={p.id} value={p.id}>{p.provider} · {formatMoney(p.amount)}</option>)}</select><input className="input" type="number" name="amount" min={1} step={1} placeholder="Amount" required /><input className="input" name="reason" placeholder="Reason" required /><button className="btn-secondary w-full">Request provider refund</button><p className="text-xs text-amber-700">All provider outcomes require staff reconciliation. Do not retry with a new key or assume a refund succeeded.</p></form></div>}
            {order.refunds.length > 0 && <div className="mt-4 text-xs text-ink-500">{order.refunds.map((r) => <p key={r.id}>{r.mode} refund · {formatMoney(r.amount)} · {r.status} · {formatDate(r.createdAt)}</p>)}</div>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6"><h2 className="font-semibold">Actions</h2>
            {order.paymentMethod === "cod" ? <div className="mt-4 space-y-3">{canWrite && <><form action={collectCodAction} className="space-y-2"><input type="hidden" name="id" value={order.id} /><input className="input" type="number" name="amount" placeholder={`Collect amount (max ${order.total})`} defaultValue={order.total} /><button className="btn-secondary w-full">Record COD collection</button></form><form action={settleCodAction}><input type="hidden" name="id" value={order.id} /><button className="btn-primary w-full">Mark COD settled</button></form></>}<p className="text-xs text-ink-400">Delivery status and financial settlement are separate records. Delivered never means settled automatically.</p></div> : <p className="mt-3 text-sm text-ink-500">Payment provider: {order.paymentMethod}. {activePayment ? `Reference ${activePayment.reference ?? "pending"} · ${activePayment.status}` : "No transaction yet."}</p>}
            {canWrite && !["CANCELLED", "RETURNED"].includes(order.status) && <form action={cancelOrderAction} className="mt-5 border-t border-ink-100 pt-5"><input type="hidden" name="id" value={order.id} /><input className="input" name="reason" placeholder="Cancellation reason" maxLength={500} /><button className="btn-danger mt-2 w-full">Record cancellation</button><p className="mt-2 text-xs text-amber-700">Cancellation is immediate. Courier cancellation, payment/refund and warehouse return remain separate. Stock is released automatically only when the goods and payment evidence are safe.</p></form>}
            {order.status === "CANCELLED" && <p className="mt-5 border-t border-ink-100 pt-4 text-xs text-ink-600">Cancellation: {order.cancellationReason ?? "historical / not recorded"}. {order.cancellationStockReleasedAt ? `Undispatched stock released ${formatDate(order.cancellationStockReleasedAt)}.` : "No automatic stock release recorded; check warehouse receipts and reconciliation."}</p>}
          </Card>
          <Card className="p-6"><h2 className="font-semibold">Internal note</h2>{canWrite ? <form action={internalNoteAction} className="mt-3"><input type="hidden" name="id" value={order.id} /><textarea className="textarea" name="internalNote" defaultValue={order.internalNote ?? ""} /><button className="btn-secondary mt-2 w-full">Save note</button></form> : <p className="mt-3 whitespace-pre-wrap text-sm text-ink-600">{order.internalNote || "No internal note."}</p>}<p className="mt-2 text-xs text-ink-400">Internal notes are never shown on customer tracking pages.</p></Card>
          <Card className="p-6"><h2 className="font-semibold">Business</h2><p className="mt-2 text-sm font-medium">{business.name}</p><p className="text-xs text-ink-500">{business.phone ?? ""} · {business.email ?? ""}</p><Link href={`/track/${order.trackingToken}`} target="_blank" className="mt-4 inline-block text-sm font-semibold text-brand-700 underline">Open customer tracking link</Link></Card>
        </div>
      </div>
    </>
  );
}
