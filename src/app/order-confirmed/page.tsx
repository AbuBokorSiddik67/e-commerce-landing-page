import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { isTrackingToken } from "@/lib/checkout-recovery";
import { PaymentReturn } from "@/components/public/PaymentReturn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order confirmed", robots: { index: false } };

export default async function OrderConfirmed({ searchParams }: { searchParams: Promise<{ order?: string; token?: string; payment?: string }> }) {
  const { order, token } = await searchParams;
  // The order number alone is not authorization to disclose order details.
  // Payment state comes from the database, never a customer-supplied URL flag.
  const found = isTrackingToken(token) ? await prisma.order.findUnique({ where: { trackingToken: token },
    select: { orderNumber: true, total: true, paymentStatus: true, paymentMethod: true } }) : null;
  const record = found && (!order || found.orderNumber === order) ? found : null;
  if (!record) return (
    <div className="container-wide max-w-2xl py-20 text-center">
      <h1 className="text-2xl font-semibold">Order confirmation unavailable</h1>
      <p className="mt-3 text-ink-600">Use your private tracking link or contact the store to check your order. Do not submit it again until it has been checked.</p>
      {!token && <PaymentReturn orderNumber={order} autoRedirect />}
      <Link href="/shop" className="mt-6 inline-block text-sm font-semibold text-brand-700 underline">Browse products</Link>
    </div>
  );
  const paid = record.paymentStatus === "PAID" || ["COD_PENDING", "COD_COLLECTED"].includes(record.paymentStatus);
  return (
    <div className="container-wide max-w-2xl py-20 text-center">
      <CheckCircle2 className="mx-auto text-brand-600" size={52} />
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">Thank you for your order</h1>
      <p className="mt-3 text-ink-600">Order <strong>{record.orderNumber}</strong> · ৳{record.total.toLocaleString("en-BD")} · {record.paymentMethod === "cod" ? "Cash on Delivery" : record.paymentMethod}</p>
      {record.paymentMethod === "cod" && <p className="mt-2 text-sm text-ink-500">Please keep your phone available — the store will contact you to confirm before delivery.</p>}
      {!paid && <p className="mt-2 text-sm text-amber-700">Payment is not verified. Contact the store before trying again.</p>}
      <Link href={`/track/${encodeURIComponent(token!)}`} className="btn-primary mt-8 inline-flex">Track your order</Link>
      <div className="mt-6 flex justify-center gap-5"><Link href="/cart" className="text-sm font-semibold text-brand-700 underline">Return to cart</Link><Link href="/shop" className="text-sm font-semibold text-brand-700 underline">Continue shopping</Link></div>
    </div>
  );
}
