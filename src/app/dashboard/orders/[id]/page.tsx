import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { getOrderForAdmin, STATUS_LABELS } from "@/services/orders";
import { getBusinessSettings, getCourierConfigurations } from "@/lib/settings";
import { formatDate, formatMoney, maskPhone } from "@/lib/utils";
import { CANCELLABLE_ORDER_STATUSES, COURIER_BOOKING_ORDER_STATUSES, MANUAL_ORDER_TRANSITIONS, RETURNABLE_ORDER_STATUSES, RETURN_TRANSITIONS, UNRESOLVED_COURIER_STATUSES } from "@/lib/order-lifecycle";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { bookCourierAction, cancelOrderAction, collectCodAction, internalNoteAction, manualCourierAction, orderStatusAction, settleCodAction, syncTrackingAction } from "@/app/actions/orders";
import { createReturnAction, providerRefundAction, recordRefundAction, returnStatusAction } from "@/app/actions/catalog";
import { RefundOperationKey } from "@/components/dashboard/RefundOperationKey";

export const dynamic = "force-dynamic";

export default async function OrderDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }>;
}) {
  await requirePageAccess(PERMISSIONS.ORDER_VIEW);
  const { id } = await params;
  const query = await searchParams;
  const [order, business, couriers] = await Promise.all([
    getOrderForAdmin(id), getBusinessSettings(), getCourierConfigurations(),
  ]);
  if (!order) notFound();
  const activeCouriers = couriers.filter((c) => c.enabled && c.configured);
  const activePayment = order.payments[order.payments.length - 1];
  const unresolvedCourier = order.shipments.some((shipment) => UNRESOLVED_COURIER_STATUSES.includes(shipment.status));
  const unresolvedRefund = order.refunds.some((refund) => !["RECORDED", "REFUNDED"].includes(refund.status));
  const canFulfill = !unresolvedCourier && order.refunds.length === 0
    && (order.paymentMethod === "cod" || (order.paymentStatus === "PAID" && order.payments.some((payment) => payment.status === "PAID" && payment.verifiedAt)))
    && order.returns.every((request) => request.status === "REJECTED");
  const nextStatuses = canFulfill ? MANUAL_ORDER_TRANSITIONS[order.status] : [];
  const canBookCourier = canFulfill && COURIER_BOOKING_ORDER_STATUSES.includes(order.status) && order.shipments.length === 0;
  const canRequestReturn = !unresolvedCourier && RETURNABLE_ORDER_STATUSES.includes(order.status)
    && order.returns.every((request) => request.status === "REJECTED");

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
            {nextStatuses.length > 0 && <form action={orderStatusAction} className="mt-5 grid gap-3 border-t border-ink-100 pt-5 sm:grid-cols-[1fr_1fr_auto]"><input type="hidden" name="id" value={order.id} /><select className="input" name="status">{nextStatuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select><input className="input" name="note" placeholder="Note (optional)" /><button className="btn-primary">Update status</button></form>}
            {!canFulfill && order.status === "PENDING" && !unresolvedCourier && <p className="mt-3 text-xs text-amber-700">Online payment must be verified and stock allocated before fulfillment.</p>}
            {unresolvedCourier && <p className="mt-3 text-xs text-amber-700">A courier outcome is unresolved. Do not retry, advance fulfillment, or release stock; reconcile it with the provider. There is no automatic resolution workflow.</p>}
          </Card>

          <Card className="p-6"><h2 className="font-semibold">Shipping & courier</h2>
            {order.shipments.length ? <div className="mt-4 space-y-4">{order.shipments.map((shipment) => <div key={shipment.id} className="rounded-xl border border-ink-100 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{shipment.providerCode === "manual" ? ((shipment.payload as { courierName?: string })?.courierName ?? "Manual courier") : shipment.providerCode} · {shipment.status}</p><Badge tone={shipment.providerCode === "manual" ? "neutral" : "info"}>{shipment.providerCode === "manual" ? "Manual entry" : "Provider API"}</Badge></div><p className="mt-1 text-xs text-ink-500">Consignment: {shipment.consignmentId ?? "—"} · Tracking: {shipment.trackingId ?? "—"} · Fee: {formatMoney(shipment.cost)}</p>{shipment.trackingUrl && <a href={shipment.trackingUrl} target="_blank" rel="noopener" className="text-xs text-brand-700 underline">Tracking link</a>}<div className="mt-3 space-y-1">{shipment.trackingEvents.map((event) => <p key={event.id} className="text-xs text-ink-500">{formatDate(event.eventAt)} · {event.status} · {event.description ?? "—"} ({event.source})</p>)}</div>{shipment.providerCode !== "manual" && shipment.status !== "PENDING" && (shipment.trackingId || shipment.consignmentId) && <form action={syncTrackingAction} className="mt-3"><input type="hidden" name="id" value={order.id} /><input type="hidden" name="shipmentId" value={shipment.id} /><button className="btn-secondary px-3 py-1.5">Sync tracking</button></form>}</div>)}</div> : <p className="mt-2 text-sm text-ink-500">No shipment assigned. Manual mode works without any provider API.</p>}
            {canBookCourier ? <div className="mt-5 grid gap-5 border-t border-ink-100 pt-5 lg:grid-cols-2">
              <form action={manualCourierAction} className="space-y-3"><h3 className="text-sm font-semibold">Assign manually</h3><input type="hidden" name="id" value={order.id} /><input className="input" name="courierName" placeholder="Courier name" required /><div className="grid grid-cols-2 gap-2"><input className="input" name="consignmentId" placeholder="Consignment ID" /><input className="input" name="trackingId" placeholder="Tracking ID" /></div><div className="grid grid-cols-2 gap-2"><input className="input" type="number" name="cost" placeholder="Courier fee" /><input className="input" type="number" name="codAmount" placeholder="COD amount" defaultValue={order.paymentMethod === "cod" && order.paymentStatus === "COD_PENDING" ? order.total : 0} /></div><select className="input" name="status"><option value="BOOKED">Booked</option><option value="IN_TRANSIT">In transit</option><option value="OUT_FOR_DELIVERY">Out for delivery</option><option value="DELIVERED">Delivered</option></select><input className="input" name="note" placeholder="Note" /><button className="btn-primary w-full">Save manual shipment</button></form>
              <form action={bookCourierAction} className="space-y-3"><h3 className="text-sm font-semibold">Book via enabled provider</h3><input type="hidden" name="id" value={order.id} /><select className="input" name="provider" required><option value="">Choose provider…</option>{activeCouriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select><button className="btn-secondary w-full" disabled={!activeCouriers.length}>Book shipment via API</button>{!activeCouriers.length && <p className="text-xs text-ink-400">No courier API is configured. Manual mode remains available.</p>}</form>
            </div> : <p className="mt-4 text-xs text-ink-500">Booking is available only for confirmed, allocated, unshipped orders without a courier record. The server rechecks eligibility.</p>}
            {order.shipments.length > 0 && <p className="mt-3 text-xs text-amber-700">Stock cancellation is blocked once a courier record exists, including failed or cancelled legacy records. Provider reconciliation is required; there is no automatic release workflow.</p>}
          </Card>

          <Card className="p-6"><h2 className="font-semibold">Returns & refunds</h2>
            {canRequestReturn && <form action={createReturnAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><input type="hidden" name="orderId" value={order.id} /><input className="input" name="reason" placeholder="Return reason" required /><button className="btn-secondary">Create return request</button></form>}
            {order.returns.map((ret) => {
              const next = unresolvedCourier || unresolvedRefund ? [] : RETURN_TRANSITIONS[ret.status].filter((status) =>
                !(ret.restock && ret.status === "INSPECTED" && ["REFUNDED", "COMPLETED"].includes(status))
                && !(!ret.restock && status === "RESTOCKED"));
              return <div key={ret.id} className="mt-4 rounded-xl border border-ink-100 p-4"><p className="text-sm font-semibold">{ret.status} · {ret.reason}</p><p className="text-xs text-ink-500">{formatDate(ret.createdAt)} · Restock: {ret.restock ? "yes" : "no"} · Refund recorded: {formatMoney(ret.refundAmount)}</p>{next.length > 0 && <form action={returnStatusAction} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="id" value={ret.id} /><input type="hidden" name="orderId" value={order.id} /><select className="input w-auto" name="status">{next.map((status) => <option key={status} value={status}>{status}</option>)}</select><input className="input w-auto" name="note" placeholder="Inspection note" /><button className="btn-secondary">Update</button></form>}</div>;
            })}
            <div className="mt-5 grid gap-5 border-t border-ink-100 pt-5 lg:grid-cols-2"><form action={recordRefundAction} className="space-y-3"><h3 className="text-sm font-semibold">Record internal refund</h3><input type="hidden" name="orderId" value={order.id} /><RefundOperationKey orderId={order.id} mode="internal" /><input className="input" type="number" name="amount" min={1} step={1} placeholder="Amount" required /><input className="input" name="reason" placeholder="Reason" required /><button className="btn-secondary w-full">Record refund (no provider call)</button></form><form action={providerRefundAction} className="space-y-3"><h3 className="text-sm font-semibold">Refund via payment provider</h3><input type="hidden" name="orderId" value={order.id} /><RefundOperationKey orderId={order.id} mode="provider" /><select className="input" name="transactionId" required><option value="">Choose verified transaction…</option>{order.payments.filter((p) => p.verifiedAt).map((p) => <option key={p.id} value={p.id}>{p.provider} · {formatMoney(p.amount)}</option>)}</select><input className="input" type="number" name="amount" min={1} step={1} placeholder="Amount" required /><input className="input" name="reason" placeholder="Reason" required /><button className="btn-secondary w-full">Request provider refund</button><p className="text-xs text-amber-700">All provider outcomes require staff reconciliation. Do not retry with a new key or assume a refund succeeded.</p></form></div>
            {order.refunds.length > 0 && <div className="mt-4 text-xs text-ink-500">{order.refunds.map((r) => <p key={r.id}>{r.mode} refund · {formatMoney(r.amount)} · {r.status} · {formatDate(r.createdAt)}</p>)}</div>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6"><h2 className="font-semibold">Actions</h2>
            {order.paymentMethod === "cod" ? <div className="mt-4 space-y-3"><form action={collectCodAction} className="space-y-2"><input type="hidden" name="id" value={order.id} /><input className="input" type="number" name="amount" placeholder={`Collect amount (max ${order.total})`} defaultValue={order.total} /><button className="btn-secondary w-full">Record COD collection</button></form><form action={settleCodAction}><input type="hidden" name="id" value={order.id} /><button className="btn-primary w-full">Mark COD settled</button></form><p className="text-xs text-ink-400">Delivery status and financial settlement are separate records. Delivered never means settled automatically.</p></div> : <p className="mt-3 text-sm text-ink-500">Payment provider: {order.paymentMethod}. {activePayment ? `Reference ${activePayment.reference ?? "pending"} · ${activePayment.status}` : "No transaction yet."}</p>}
            {order.shipments.length === 0 && CANCELLABLE_ORDER_STATUSES.includes(order.status) && ["PENDING", "FAILED", "COD_PENDING"].includes(order.paymentStatus) && <form action={cancelOrderAction} className="mt-5 border-t border-ink-100 pt-5"><input type="hidden" name="id" value={order.id} /><input className="input" name="reason" placeholder="Cancellation reason" /><button className="btn-danger mt-2 w-full">Cancel order</button>{order.paymentMethod !== "cod" && <p className="mt-2 text-xs text-amber-700">Stock is released only if payment was never started or the provider verifies the whole session is closed and unpaid. Current adapters do not establish session closure; uncertain or paid sessions require reconciliation.</p>}</form>}
          </Card>
          <Card className="p-6"><h2 className="font-semibold">Internal note</h2><form action={internalNoteAction} className="mt-3"><input type="hidden" name="id" value={order.id} /><textarea className="textarea" name="internalNote" defaultValue={order.internalNote ?? ""} /><button className="btn-secondary mt-2 w-full">Save note</button></form><p className="mt-2 text-xs text-ink-400">Internal notes are never shown on customer tracking pages.</p></Card>
          <Card className="p-6"><h2 className="font-semibold">Business</h2><p className="mt-2 text-sm font-medium">{business.name}</p><p className="text-xs text-ink-500">{business.phone ?? ""} · {business.email ?? ""}</p><Link href={`/track/${order.trackingToken}`} target="_blank" className="mt-4 inline-block text-sm font-semibold text-brand-700 underline">Open customer tracking link</Link></Card>
        </div>
      </div>
    </>
  );
}
