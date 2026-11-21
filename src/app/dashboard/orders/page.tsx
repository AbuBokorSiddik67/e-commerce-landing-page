import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import Link from "next/link";
import { listOrders } from "@/services/orders";
import { expireReservationsAction } from "@/app/actions/orders";
import { formatDate, formatMoney } from "@/lib/utils";
import { Alert, Badge, EmptyState, PageHeader, Pagination } from "@/components/ui";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; status?: string; paymentMethod?: string; from?: string; to?: string; error?: string; success?: string }> }) {
  await requirePageAccess(PERMISSIONS.ORDER_VIEW);
  const params = await searchParams;
  const result = await listOrders({ ...params, page: Number(params.page ?? 1) });
  const query = new URLSearchParams(Object.entries(params).filter(([k]) => ["search", "status", "paymentMethod", "from", "to"].includes(k)).map(([k, v]) => [k, String(v ?? "")]));
  return (
    <>
      <PageHeader title="Orders" description="Search, filter and fulfil orders. Delivery and financial settlement are tracked separately." action={<a href={`/api/orders/export?${query.toString()}`} className="btn-secondary">Export CSV</a>} />
      <Alert error={params.error} success={params.success} />
      <form action={expireReservationsAction} className="mb-5 flex flex-wrap items-center gap-3">
        <button className="btn-secondary">Process safely expired payment holds</button>
        <span className="text-xs text-ink-500">Only payments proven unstarted or provider-verified closed qualify. Current providers do not yet verify session closure; uncertain payments remain reserved.</span>
      </form>
      <form method="get" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input className="input" name="search" placeholder="Order / phone / customer" defaultValue={params.search} />
        <select className="input" name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option>{["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURNED", "FAILED_DELIVERY"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select>
        <select className="input" name="paymentMethod" defaultValue={params.paymentMethod ?? ""}><option value="">All payments</option><option value="cod">COD</option><option value="sslcommerz">SSLCommerz</option><option value="bkash">bKash</option><option value="nagad">Nagad</option></select>
        <input className="input" type="date" name="from" defaultValue={params.from} />
        <div className="flex gap-2"><input className="input" type="date" name="to" defaultValue={params.to} /><button className="btn-secondary">Filter</button></div>
      </form>
      {result.items.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Financial</th><th>Status</th><th>Date</th></tr></thead><tbody>{result.items.map((order) => <tr key={order.id}><td><Link href={`/dashboard/orders/${order.id}`} className="font-semibold text-brand-700 hover:underline">{order.orderNumber}</Link><p className="text-xs text-ink-400">{order.items.map((i) => i.name).join(", ")}</p></td><td>{order.customer.name}<p className="text-xs text-ink-400">{order.customer.phone}</p></td><td>{formatMoney(order.total)}</td><td><Badge tone={order.paymentStatus === "PAID" || order.paymentStatus.startsWith("COD_") ? "success" : "warning"}>{order.paymentMethod} · {order.paymentStatus.replaceAll("_", " ")}</Badge></td><td className="text-xs">{order.financialStatus.replaceAll("_", " ")}<p className="text-ink-400">Settlement: {order.settlementStatus.toLowerCase()}</p></td><td><Badge tone={order.status === "DELIVERED" ? "success" : order.status === "CANCELLED" ? "danger" : "info"}>{order.status.replaceAll("_", " ")}</Badge></td><td>{formatDate(order.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No orders found" description="Orders placed on published landing pages appear here." />}
      <Pagination page={result.page} pages={result.pages} basePath="/dashboard/orders" />
    </>
  );
}
