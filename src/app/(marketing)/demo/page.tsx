import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { LinkButton } from "@/components/ui";

export const metadata = { title: "Live demo" };

export default function DemoPage() {
  return (
    <div className="container-wide py-20">
      <div className="mx-auto max-w-2xl text-center">
        <span className="section-label">Public storefront</span>
        <h1 className="mt-3 h-display">See a real landing page</h1>
        <p className="mt-5 text-ink-600">This demo page is rendered by the same engine business owners manage in the dashboard. Place a test order to see the COD workflow end to end.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton href="/p/premium-cotton-t-shirt">Open demo storefront <ArrowRight size={16} /></LinkButton>
          <LinkButton href="/login" variant="secondary">Owner login</LinkButton>
        </div>
        <div className="mt-10 rounded-2xl border border-ink-100 bg-white p-6 text-left shadow-card">
          <div className="flex items-center gap-2 text-sm font-semibold"><ShoppingBag size={18} className="text-brand-600" /> Demo credentials</div>
          <p className="mt-2 text-sm text-ink-600">Owner: <code className="rounded bg-ink-100 px-2 py-1">owner@landiq.local</code> · Password: <code className="rounded bg-ink-100 px-2 py-1">Owner@123456789</code></p>
          <p className="mt-2 text-xs text-ink-400">Change the password immediately on a real installation. Demo data is reset with each seed.</p>
        </div>
        <p className="mt-6 text-sm text-ink-500">After placing an order, use the tracking link shown on the confirmation screen. <Link href="/track/demo" className="font-semibold text-brand-700 underline">Example tracking view</Link></p>
      </div>
    </div>
  );
}
