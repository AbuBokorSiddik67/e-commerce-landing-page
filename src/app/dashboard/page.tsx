import Link from "next/link";
import { ArrowUpRight, Boxes, ClipboardList, CreditCard, FileText, ShoppingCart, TrendingUp } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getDashboardMetrics, resolveRange } from "@/services/analytics";
import { lowStockVariants } from "@/services/inventory";
import { formatDate, formatMoney } from "@/lib/utils";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";

export default async function DashboardOverview({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requirePageAccess(PERMISSIONS.DASHBOARD_VIEW);
  const canAnalytics = user.permissions.has(PERMISSIONS.ANALYTICS_VIEW);
  const canOrders = user.permissions.has(PERMISSIONS.ORDER_VIEW);
  const canInventory = user.permissions.has(PERMISSIONS.INVENTORY_VIEW);
  const canNotifications = user.permissions.has(PERMISSIONS.NOTIFICATION_VIEW);
  const { range } = await searchParams;
  // Layouts and pages may render in parallel. Authorize each read here, before
  // issuing it, rather than relying on navigation visibility or the layout.
  const [metrics, recentOrders, lowStock, notifications] = await Promise.all([
    canAnalytics ? getDashboardMetrics(resolveRange(range ?? "30d")) : null,
    canOrders ? prisma.order.findMany({ include: { customer: true }, orderBy: { createdAt: "desc" }, take: 6 }) : [],
    canInventory ? lowStockVariants(5) : [],
    canNotifications ? prisma.notification.findMany({ where: { readAt: null }, orderBy: { createdAt: "desc" }, take: 5 }) : [],
  ]);

  return (
    <>
      <PageHeader title="Overview" description="A measured view of your installation." action={<div className="flex gap-2">{["today", "7d", "30d"].map((r) => <Link key={r} href={`/dashboard?range=${r}`} className={`btn-secondary ${range === r || (!range && r === "30d") ? "border-brand-500 text-brand-700" : ""}`}>{r === "today" ? "Today" : r === "7d" ? "7 days" : "30 days"}</Link>)}</div>} />
      {metrics && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={formatMoney(metrics.revenue)} hint={`Net after recorded refunds: ${formatMoney(metrics.netRevenue)}`} icon={<TrendingUp size={20} />} />
        <StatCard label="Orders" value={metrics.totalOrders} hint={`${metrics.confirmedOrders} confirmed · ${metrics.deliveredOrders} delivered`} icon={<ShoppingCart size={20} />} />
        <StatCard label="Page views" value={metrics.pageViews} hint={`${metrics.uniqueVisitors} unique visitors · ${metrics.conversionRate}% conversion`} icon={<FileText size={20} />} />
        <StatCard label="Products / pages" value={`${metrics.products} / ${metrics.publishedPages}`} hint="Published landing pages" icon={<Boxes size={20} />} />
      </div>}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {canOrders && <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Recent orders</h2><Link href="/dashboard/orders" className="flex items-center gap-1 text-xs font-semibold text-brand-700">View all <ArrowUpRight size={14} /></Link></div>
          {recentOrders.length ? <div className="table-wrap mt-4 border-0"><table className="table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>{recentOrders.map((order) => <tr key={order.id}><td><Link href={`/dashboard/orders/${order.id}`} className="font-semibold text-brand-700 hover:underline">{order.orderNumber}</Link></td><td>{order.customer.name}</td><td>{formatMoney(order.total)}</td><td className="capitalize">{order.paymentMethod}</td><td><Badge tone={order.status === "DELIVERED" ? "success" : order.status === "CANCELLED" ? "danger" : "info"}>{order.status.replaceAll("_", " ")}</Badge></td></tr>)}</tbody></table></div> : <EmptyState title="No orders yet" description="Share a published landing page to receive your first order." />}
        </Card>}
        <div className="space-y-6">
          {canInventory && <Card className="p-6"><h2 className="font-semibold">Low stock</h2>{lowStock.length ? <ul className="mt-4 space-y-3">{lowStock.slice(0, 5).map((variant) => <li key={variant.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate">{variant.product.name}<span className="block text-xs text-ink-400">{variant.name}</span></span><Badge tone={variant.stock === 0 ? "danger" : "warning"}>{variant.stock} left</Badge></li>)}</ul> : <p className="mt-3 text-sm text-ink-500">All variants are above their alert threshold.</p>}<Link href="/dashboard/inventory" className="mt-4 inline-block text-xs font-semibold text-brand-700 underline">Manage inventory</Link></Card>}
          {canNotifications && <Card className="p-6"><h2 className="font-semibold">Unread notifications</h2>{notifications.length ? <ul className="mt-4 space-y-3">{notifications.map((n) => <li key={n.id} className="text-sm"><p className="font-medium">{n.title}</p><p className="text-xs text-ink-400">{formatDate(n.createdAt)}</p></li>)}</ul> : <p className="mt-3 text-sm text-ink-500">You&apos;re all caught up.</p>}<Link href="/dashboard/notifications" className="mt-4 inline-block text-xs font-semibold text-brand-700 underline">View all</Link></Card>}
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-4 p-5"><CreditCard className="text-brand-600" /><div><p className="text-sm font-semibold">COD first</p><p className="text-xs text-ink-500">No gateway required to sell.</p></div></Card>
        <Card className="flex items-center gap-4 p-5"><ClipboardList className="text-brand-600" /><div><p className="text-sm font-semibold">Separate settlement</p><p className="text-xs text-ink-500">Delivery and finances stay distinct.</p></div></Card>
        {metrics && <Card className="flex items-center gap-4 p-5"><ShoppingCart className="text-brand-600" /><div><p className="text-sm font-semibold">{metrics.ctaClicks} CTA clicks</p><p className="text-xs text-ink-500">Measured in this period.</p></div></Card>}
      </div>
    </>
  );
}
