import Link from "next/link";
import { formatDate, maskAddress, maskPhone } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrderByTrackingToken, STATUS_LABELS } from "@/services/orders";
import { Badge } from "@/components/ui";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Track your order", robots: { index: false, follow: false } };

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  checkRateLimit(`track:${h.get("x-forwarded-for") ?? "unknown"}`, 25, 60 * 60 * 1000);
  const order = token === "demo" ? null : await getOrderByTrackingToken(token);
  if (!order) {
    return (
      <div className="container-wide max-w-xl py-20 text-center">
        <h1 className="text-2xl font-semibold">Tracking link not found</h1>
        <p className="mt-3 text-sm text-ink-500">Check the link from your order confirmation and try again. For help, contact the store using the number on your order.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-brand-700 underline">Return home</Link>
      </div>
    );
  }
  const shipment = order.shipments[order.shipments.length - 1];
  const courierName = shipment ? ((shipment.payload as { courierName?: string })?.courierName ?? shipment.providerCode) : "Not assigned yet";
  const deliverableStatuses = new Set(["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"]);

  return (
    <div className="min-h-screen bg-ink-50 py-12">
      <div className="container-wide max-w-3xl">
        <div className="mb-6"><Link href="/" className="text-sm text-ink-500 hover:text-brand-700">← Back to store</Link></div>
        <div className="surface p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="section-label">Order tracking</p><h1 className="mt-2 text-2xl font-semibold">{order.orderNumber}</h1><p className="mt-1 text-sm text-ink-500">Placed {formatDate(order.createdAt)}</p></div>
            <Badge tone={order.status === "DELIVERED" ? "success" : order.status === "CANCELLED" ? "danger" : "info"}>{STATUS_LABELS[order.status]}</Badge>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-ink-50 p-4"><p className="text-xs text-ink-500">Product</p><p className="mt-1 font-medium">{order.items.map((i) => `${i.name} × ${i.quantity}`).join(", ")}</p></div>
            <div className="rounded-xl bg-ink-50 p-4"><p className="text-xs text-ink-500">Order total</p><p className="mt-1 font-semibold">৳{order.total.toLocaleString("en-BD")}</p></div>
            <div className="rounded-xl bg-ink-50 p-4"><p className="text-xs text-ink-500">Payment method</p><p className="mt-1 font-medium">{order.paymentMethod === "cod" ? "Cash on Delivery" : order.paymentMethod}</p></div>
            <div className="rounded-xl bg-ink-50 p-4"><p className="text-xs text-ink-500">Delivery option</p><p className="mt-1 font-medium capitalize">{order.deliveryOption.replace("_", " ")}</p></div>
            <div className="rounded-xl bg-ink-50 p-4"><p className="text-xs text-ink-500">Customer</p><p className="mt-1 font-medium">{order.customer.name} · {maskPhone(order.customer.phone)}</p></div>
            <div className="rounded-xl bg-ink-50 p-4"><p className="text-xs text-ink-500">Delivery area</p><p className="mt-1 font-medium">{order.district}{order.area ? `, ${order.area}` : ""}</p></div>
          </div>
          <div className="mt-8">
            <h2 className="font-semibold">Status timeline</h2>
            <ol className="mt-4 space-y-0">
              {order.statusHistory.map((event, index) => (
                <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                  <div className="flex flex-col items-center"><span className="mt-1 h-3 w-3 rounded-full bg-brand-600 ring-4 ring-brand-50" />{index < order.statusHistory.length - 1 && <span className="mt-2 h-full w-px bg-ink-200" />}</div>
                  <div><p className="text-sm font-semibold">{STATUS_LABELS[event.toStatus]}</p><p className="text-xs text-ink-500">{formatDate(event.createdAt, { dateStyle: "medium", timeStyle: "short" })} · {event.source === "MANUAL" ? "Store update" : event.source === "PAYMENT_PROVIDER" ? "Payment verified" : "Status update"}</p></div>
                </li>
              ))}
            </ol>
          </div>
          {shipment && (
            <div className="mt-6 rounded-xl border border-ink-100 p-4">
              <h2 className="font-semibold">Delivery details</h2>
              <p className="mt-2 text-sm text-ink-600">Courier: {courierName}{shipment.providerCode !== "manual" ? " (verified provider update)" : " (manual update)"}</p>
              {shipment.trackingId && <p className="mt-1 text-sm text-ink-600">Tracking ID: {shipment.trackingId}</p>}
              {shipment.trackingUrl && <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-brand-700 underline">Open courier tracking</a>}
            </div>
          )}
          {order.expectedDeliveryAt && <p className="mt-4 text-sm text-ink-600">Expected delivery: {formatDate(order.expectedDeliveryAt)}</p>}
          <p className="mt-6 text-xs text-ink-400">For privacy, phone numbers and full addresses are hidden on this page. Never share your tracking link publicly.</p>
        </div>
      </div>
    </div>
  );
}
