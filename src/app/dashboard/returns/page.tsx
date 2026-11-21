import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/utils";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export default async function ReturnsPage() {
  await requirePageAccess(PERMISSIONS.ORDER_VIEW);
  const [returns, refunds] = await Promise.all([
    prisma.returnRequest.findMany({ include: { order: true, product: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.refund.findMany({ include: { order: { select: { orderNumber: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return (
    <>
      <PageHeader title="Returns & refunds" description="Inspection, restocking and recorded refunds. Provider refunds are only marked complete when the API confirms them." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>{returns.length ? <div className="space-y-3">{returns.map((item) => <Card key={item.id} className="p-5"><div className="flex justify-between"><div><p className="font-semibold">{item.product.name}</p><p className="text-xs text-ink-500">Order <Link href={`/dashboard/orders/${item.orderId}`} className="text-brand-700 underline">{item.order.orderNumber}</Link> · {formatDate(item.createdAt)}</p></div><Badge tone={item.status === "COMPLETED" ? "success" : "warning"}>{item.status}</Badge></div><p className="mt-3 text-sm text-ink-600">{item.reason}</p><p className="mt-2 text-xs text-ink-400">Restock: {item.restock ? "yes" : "no"} · Return charge: {formatMoney(item.returnCharge)} · Refund: {formatMoney(item.refundAmount)}</p></Card>)}</div> : <EmptyState title="No return requests" description="Return requests from order pages appear here." />}</div>
        <Card className="p-6"><h2 className="font-semibold">Refund records</h2><div className="mt-4 space-y-3">{refunds.map((refund) => <div key={refund.id} className="border-b border-ink-100 pb-3 last:border-0"><p className="text-sm font-medium">{formatMoney(refund.amount)} · {refund.mode} · {refund.status}</p><p className="text-xs text-ink-500">{refund.order.orderNumber} · {refund.reason} · {formatDate(refund.createdAt)}</p></div>)}{!refunds.length && <p className="text-sm text-ink-500">No refunds recorded.</p>}</div></Card>
      </div>
    </>
  );
}
