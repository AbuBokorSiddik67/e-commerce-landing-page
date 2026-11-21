import { ArrowRight, ShoppingBag } from "lucide-react";
import { LinkButton } from "@/components/ui";

export const metadata = { title: "Live demo" };

export default function DemoPage() {
  return (
    <div className="container-wide py-20">
      <div className="mx-auto max-w-2xl text-center">
        <span className="section-label">Public storefront</span>
        <h1 className="mt-3 h-display">Explore the storefront</h1>
        <p className="mt-5 text-ink-600">Browse products and landing pages published by this store. To try an order, use a dedicated test installation rather than a live store.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton href="/shop">Open storefront <ArrowRight size={16} /></LinkButton>
          <LinkButton href="/login" variant="secondary">Owner login</LinkButton>
        </div>
        <div className="mt-10 rounded-2xl border border-ink-100 bg-white p-6 text-left shadow-card">
          <div className="flex items-center gap-2 text-sm font-semibold"><ShoppingBag size={18} className="text-brand-600" /> Store access</div>
          <p className="mt-2 text-sm text-ink-600">Owners sign in with the private credentials configured when the store was created. There is no public demo password.</p>
        </div>
        <p className="mt-6 text-sm text-ink-500">After placing an order, keep the private tracking link shown on the confirmation screen.</p>
      </div>
    </div>
  );
}
