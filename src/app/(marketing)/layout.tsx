import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <main>{children}</main>
      <footer className="border-t border-ink-100 bg-ink-950 py-12 text-ink-300">
        <div className="container-wide grid gap-8 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2 text-white"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 font-display font-bold">L</span><span className="font-semibold">LANDIQ</span></div>
            <p className="mt-3 text-sm text-ink-400">One installation. One business. Complete control over your storefronts.</p>
          </div>
          <div><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">Product</p><div className="space-y-2 text-sm"><Link className="block hover:text-white" href="/features">Features</Link><Link className="block hover:text-white" href="/how-it-works">How it works</Link><Link className="block hover:text-white" href="/demo">Live demo page</Link></div></div>
          <div><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">Resources</p><div className="space-y-2 text-sm"><Link className="block hover:text-white" href="/docs">Documentation</Link><Link className="block hover:text-white" href="/purchase">Purchase information</Link><Link className="block hover:text-white" href="/track/demo">Order tracking</Link></div></div>
          <div><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">Legal</p><div className="space-y-2 text-sm"><Link className="block hover:text-white" href="/privacy">Privacy policy</Link><Link className="block hover:text-white" href="/terms">Terms</Link><Link className="block hover:text-white" href="/contact">Contact</Link></div></div>
        </div>
        <div className="container-wide mt-10 border-t border-white/10 pt-6 text-xs text-ink-500">© {new Date().getFullYear()} LANDIQ. Independent installation software; no subscriptions or shared hosting.</div>
      </footer>
    </div>
  );
}
