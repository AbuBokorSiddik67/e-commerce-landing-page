import { getDashboardMetrics, getDailySeries, resolveRange } from "@/services/analytics";
import { formatMoney } from "@/lib/utils";
import { Card, PageHeader, StatCard } from "@/components/ui";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const range = resolveRange(params.range ?? "30d", params.from, params.to);
  const [metrics, series] = await Promise.all([getDashboardMetrics(range), getDailySeries(range)]);
  const max = Math.max(1, ...series.map((s) => s.pageViews));
  return (
    <>
      <PageHeader title="Analytics" description="Metrics come from recorded events and orders. Revenue counts only paid or collected, non-cancelled orders." action={<form method="get" className="flex flex-wrap gap-2"><select className="input w-auto" name="range" defaultValue={params.range ?? "30d"}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option><option value="custom">Custom range</option></select><input className="input w-auto" type="date" name="from" defaultValue={params.from} /><input className="input w-auto" type="date" name="to" defaultValue={params.to} /><button className="btn-secondary">Apply</button></form>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Page views" value={metrics.pageViews} hint={`${metrics.uniqueVisitors} unique visitors`} /><StatCard label="CTA clicks" value={metrics.ctaClicks} hint={`${metrics.viewContent} ViewContent events`} /><StatCard label="Conversion rate" value={`${metrics.conversionRate}%`} hint="Orders ÷ unique visitors" /><StatCard label="Net revenue" value={formatMoney(metrics.netRevenue)} hint={`Gross ${formatMoney(metrics.revenue)} after refunds`} /></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2"><Card className="p-6"><h2 className="font-semibold">Orders by status</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><p>Total orders: <strong>{metrics.totalOrders}</strong></p><p>Confirmed: <strong>{metrics.confirmedOrders}</strong></p><p>Delivered: <strong>{metrics.deliveredOrders}</strong></p><p>Cancelled: <strong>{metrics.cancelledOrders}</strong></p><p>Published pages: <strong>{metrics.publishedPages}</strong></p><p>Products: <strong>{metrics.products}</strong></p></div></Card><Card className="p-6"><h2 className="font-semibold">Daily page views</h2><div className="mt-5 flex h-44 items-end gap-1">{series.map((day) => <div key={day.date} className="flex-1 rounded-t bg-brand-500/80" style={{ height: `${Math.max(2, (day.pageViews / max) * 100)}%` }} title={`${day.date}: ${day.pageViews} views`} />)}</div><div className="mt-2 flex justify-between text-xs text-ink-400"><span>{series[0]?.date}</span><span>{series[series.length - 1]?.date}</span></div></Card></div>
      <Card className="mt-6 p-6"><h2 className="font-semibold">Daily breakdown</h2><div className="table-wrap mt-4"><table className="table"><thead><tr><th>Date</th><th>Page views</th><th>CTA clicks</th><th>Orders</th><th>Paid revenue</th></tr></thead><tbody>{series.slice().reverse().map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.pageViews}</td><td>{day.ctaClicks}</td><td>{day.orders}</td><td>{formatMoney(day.revenue)}</td></tr>)}</tbody></table></div></Card>
    </>
  );
}
