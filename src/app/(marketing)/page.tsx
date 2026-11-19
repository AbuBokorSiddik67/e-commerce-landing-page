import Link from "next/link";
import { ArrowRight, Boxes, FileText, Gauge, Package, ShieldCheck, ShoppingBag } from "lucide-react";
import { LinkButton, Card } from "@/components/ui";

const features = [
  { icon: Package, title: "Products & variants", text: "Flexible attributes, SKUs, images, pricing and stock for any product category." },
  { icon: FileText, title: "Landing page builder", text: "A section-based editor with 22 blocks, templates, drafts and scheduled publishing." },
  { icon: ShoppingBag, title: "Orders & COD accounting", text: "Secure checkout, unique order numbers, tracking links and separate settlement records." },
  { icon: Gauge, title: "Honest analytics", text: "Measured page views, CTA clicks, orders and revenue with clear date filters." },
  { icon: ShieldCheck, title: "Access control", text: "Seven roles, server-side permissions, audit logs and private customer data." },
  { icon: Boxes, title: "Optional integrations", text: "Payments and couriers are independently switchable. COD and manual courier always work." },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-ink-950 text-white">
        <div className="absolute -right-32 -top-40 h-[500px] w-[500px] rounded-full bg-brand-600/20 blur-3xl" />
        <div className="container-wide relative grid gap-12 py-20 lg:grid-cols-2 lg:py-28">
          <div className="animate-fade-up">
            <span className="badge bg-white/10 text-brand-200">Independent installation · One-time purchase</span>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.06] tracking-tight sm:text-6xl">Your products.<br />Your pages.<br /><span className="text-brand-300">Your business.</span></h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-200">LANDIQ turns one installation into a complete direct-to-customer store. Build focused landing pages for every product, take Cash on Delivery orders, and manage the whole business from one dashboard.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/p/premium-cotton-t-shirt" variant="primary" className="bg-brand-500 hover:bg-brand-400">See a live storefront <ArrowRight size={16} /></LinkButton>
              <LinkButton href="/features" variant="secondary" className="border-white/20 bg-transparent text-white hover:bg-white/10">Explore features</LinkButton>
            </div>
            <p className="mt-6 text-sm text-ink-400">No subscriptions · No mandatory gateway · No multi-tenant platform</p>
          </div>
          <div className="relative">
            <div className="surface overflow-hidden border-white/10 bg-white/95 p-2 shadow-2xl">
              <div className="rounded-xl bg-gradient-to-br from-brand-50 to-white p-6">
                <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-widest text-brand-700">Store dashboard</span><span className="badge bg-emerald-50 text-emerald-700">COD ready</span></div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[["Products", "24"], ["Pages", "18"], ["Orders", "142"], ["Revenue", "৳84k"]].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs text-ink-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  {["New order · #LDQ-20418", "Page published · Wireless Earbuds", "Stock alert · Smart Watch"].map((row, i) => (
                    <div key={row} className="flex items-center justify-between rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm"><span>{row}</span><span className={`h-2 w-2 rounded-full ${i === 0 ? "bg-emerald-500" : "bg-ink-300"}`} /></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container-wide py-20">
        <div className="mx-auto max-w-2xl text-center"><span className="section-label">Built for real businesses</span><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Everything you need to sell, without anything you don&apos;t</h2><p className="mt-4 text-ink-500">Payments and couriers stay optional. COD and manual delivery tracking are first-class workflows, not fallbacks.</p></div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => <Card key={feature.title} className="p-6"><feature.icon className="text-brand-600" size={24} /><h3 className="mt-4 font-semibold text-ink-900">{feature.title}</h3><p className="mt-2 text-sm leading-relaxed text-ink-500">{feature.text}</p></Card>)}
        </div>
      </section>

      <section className="bg-ink-900 py-16 text-white">
        <div className="container-wide grid gap-8 md:grid-cols-3">
          {[
            ["1", "Install", "Deploy the application on your own server with your database and domain."],
            ["2", "Configure", "Set your business details, delivery charges and which payment methods to offer."],
            ["3", "Publish & sell", "Create a page per product, share the link and process orders from your dashboard."],
          ].map(([number, title, text]) => <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-6"><span className="font-display text-3xl text-brand-300">{number}</span><h3 className="mt-2 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm text-ink-300">{text}</p></div>)}
        </div>
        <div className="container-wide mt-10"><Link href="/how-it-works" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-300 hover:text-brand-200">Read the full process <ArrowRight size={16} /></Link></div>
      </section>
    </>
  );
}
