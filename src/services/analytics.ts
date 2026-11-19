import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils";

export type DateRange = { from: Date; to: Date };

export function resolveRange(range: string, customFrom?: string, customTo?: string): DateRange {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  if (range === "custom") {
    return {
      from: customFrom ? new Date(`${customFrom}T00:00:00`) : daysAgo(30),
      to: customTo ? new Date(`${customTo}T23:59:59`) : to,
    };
  }
  const days: Record<string, number> = { today: 0, yesterday: 1, "7d": 6, "30d": 29, month: new Date().getDate() - 1 };
  const count = days[range] ?? 29;
  const from = daysAgo(count);
  if (range === "today" || range === "yesterday") from.setHours(0, 0, 0, 0);
  if (range === "yesterday") {
    from.setDate(from.getDate() - 1);
    to.setTime(from.getTime());
    to.setHours(23, 59, 59, 999);
  }
  return { from, to };
}

export async function recordEvent(input: {
  type: string; pageId?: string; productId?: string; orderId?: string; visitorId: string; metadata?: Record<string, unknown>;
}) {
  await prisma.analyticsEvent.create({
    data: {
      type: input.type.slice(0, 60), pageId: input.pageId ?? null, productId: input.productId ?? null,
      orderId: input.orderId ?? null, visitorId: input.visitorId.slice(0, 100),
      metadata: (input.metadata ?? {}) as never,
    },
  });
}

export async function getDashboardMetrics(range: DateRange) {
  const where = { createdAt: { gte: range.from, lte: range.to } };
  const [
    products, publishedPages, pageViews, uniqueVisitorRows, ctaClicks,
    orders, confirmed, delivered, cancelled, revenueAgg, refundsAgg, events,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.landingPage.count({ where: { status: "PUBLISHED" } }),
    prisma.analyticsEvent.count({ where: { ...where, type: "page_view" } }),
    prisma.analyticsEvent.groupBy({ by: ["visitorId"], where: { ...where, type: "page_view" } }),
    prisma.analyticsEvent.count({ where: { ...where, type: "cta_click" } }),
    prisma.order.findMany({ where, select: { id: true, status: true, total: true, paymentStatus: true } }),
    prisma.order.count({ where: { ...where, status: { in: ["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"] } } }),
    prisma.order.count({ where: { ...where, status: "DELIVERED" } }),
    prisma.order.count({ where: { ...where, status: "CANCELLED" } }),
    prisma.order.aggregate({
      where: { ...where, status: { not: "CANCELLED" }, paymentStatus: { in: ["PAID", "COD_COLLECTED"] } },
      _sum: { total: true },
    }),
    prisma.refund.aggregate({ where: { createdAt: where.createdAt, status: { in: ["REFUNDED", "RECORDED"] } }, _sum: { amount: true } }),
    prisma.analyticsEvent.groupBy({ by: ["type"], where, _count: { type: true } }),
  ]);
  const countOf = (type: string) => events.find((e) => e.type === type)?._count.type ?? 0;
  const revenue = revenueAgg._sum?.total ?? 0;
  const netRevenue = revenue - (refundsAgg._sum?.amount ?? 0);
  const uniqueVisitors = uniqueVisitorRows.length;
  return {
    products, publishedPages, pageViews, uniqueVisitors, ctaClicks,
    totalOrders: orders.length, confirmedOrders: confirmed, deliveredOrders: delivered, cancelledOrders: cancelled,
    revenue, netRevenue,
    conversionRate: uniqueVisitors ? Number(((orders.length / uniqueVisitors) * 100).toFixed(2)) : 0,
    viewContent: countOf("view_content"),
    initiateCheckout: countOf("initiate_checkout"),
  };
}

export async function getDailySeries(range: DateRange) {
  const orders = await prisma.order.findMany({ where: { createdAt: { gte: range.from, lte: range.to } }, select: { createdAt: true, total: true, status: true, paymentStatus: true } });
  const events = await prisma.analyticsEvent.findMany({
    where: { createdAt: { gte: range.from, lte: range.to }, type: { in: ["page_view", "cta_click"] } }, select: { createdAt: true, type: true, visitorId: true },
  });
  const map = new Map<string, { date: string; orders: number; revenue: number; pageViews: number; ctaClicks: number }>();
  const key = (date: Date) => date.toISOString().slice(0, 10);
  for (let d = new Date(range.from); d <= range.to; d.setDate(d.getDate() + 1)) {
    map.set(key(d), { date: key(d), orders: 0, revenue: 0, pageViews: 0, ctaClicks: 0 });
  }
  for (const order of orders) {
    const row = map.get(key(order.createdAt));
    if (!row) continue;
    row.orders += 1;
    if (order.paymentStatus === "PAID" && order.status !== "CANCELLED") row.revenue += order.total;
  }
  for (const event of events) {
    const row = map.get(key(event.createdAt));
    if (!row) continue;
    if (event.type === "page_view") row.pageViews += 1;
    if (event.type === "cta_click") row.ctaClicks += 1;
  }
  return [...map.values()];
}
