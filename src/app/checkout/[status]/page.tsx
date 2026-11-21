import Link from "next/link";
import { notFound } from "next/navigation";
import { PaymentReturn } from "@/components/public/PaymentReturn";

export const dynamic = "force-dynamic";

export default async function CheckoutStatus({ params, searchParams }: {
  params: Promise<{ status: string }>; searchParams: Promise<{ order?: string; reason?: string }>;
}) {
  const { status } = await params;
  if (!["failed", "cancelled"].includes(status)) notFound();
  const { order, reason } = await searchParams;
  return (
    <div className="container-wide max-w-xl py-20 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{status === "cancelled" ? "Checkout cancelled" : "Payment could not be completed"}</h1>
      <p className="mt-4 text-ink-600">{reason ?? (status === "cancelled" ? "Payment was not confirmed here. Your order may still be reserved; contact the store before placing it again." : "The provider did not confirm this payment. Your order is not marked as paid.")}</p>
      {order && <p className="mt-2 text-sm text-ink-500">Order reference: {order}</p>}
      <PaymentReturn orderNumber={order} />
      <div><Link href="/shop" className="btn-primary mt-8 inline-flex">Return to store</Link></div>
    </div>
  );
}
