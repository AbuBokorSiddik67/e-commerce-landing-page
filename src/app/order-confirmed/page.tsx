import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order confirmed", robots: { index: false } };

export default async function OrderConfirmed({ searchParams }: { searchParams: Promise<{ order?: string; token?: string; payment?: string }> }) {
  const { order, token, payment } = await searchParams;
  const record = order ? await prisma.order.findUnique({ where: { orderNumber: order }, select: { orderNumber: true, total: true, paymentStatus: true, paymentMethod: true } }) : null;
  const verified = payment === "verified";
  const paid = verified || record?.paymentStatus === "PAID" || record?.paymentStatus === "COD_PENDING";
  return (
    <div className="container-wide max-w-2xl py-20 text-center">
      <CheckCircle2 className="mx-auto text-brand-600" size={52} />
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">Thank you for your order</h1>
      <p className="mt-3 text-ink-600">{record ? <>Order <strong>{record.orderNumber}</strong> · ৳{record.total.toLocaleString("en-BD")} · {record.paymentMethod === "cod" ? "Cash on Delivery" : record.paymentMethod}</> : "Your order has been received."}</p>
      {record?.paymentMethod === "cod" && <p className="mt-2 text-sm text-ink-500">Please keep your phone available — the store will contact you to confirm before delivery.</p>}
      {payment === "failed" && <div className="alert-error mt-6 text-left">Payment verification failed. The order was not marked as paid. Contact the store before trying again.</div>}
      {!paid && payment !== "failed" && <p className="mt-2 text-sm text-amber-700">Payment is being verified by the provider. Do not place a second order.</p>}
      {token && <Link href={`/track/${token}`} className="btn-primary mt-8 inline-flex">Track your order</Link>}
      <div className="mt-6"><Link href="/" className="text-sm font-semibold text-brand-700 underline">Continue shopping</Link></div>
    </div>
  );
}
