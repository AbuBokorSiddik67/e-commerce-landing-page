import Link from "next/link";
import { Card } from "@/components/ui";

export const metadata = { title: "Documentation" };

const topics: Array<[string, string[]]> = [
  ["Getting started", ["Deployment and HTTPS", "Environment variables", "First owner account", "Business settings"]],
  ["Store operations", ["Products and variants", "Inventory movements", "Landing page builder", "SEO and redirects"]],
  ["Payments & delivery", ["COD-only setup", "Provider enable/disable", "Callback verification", "Manual courier workflow"]],
  ["Operations", ["Staff permissions", "Backup and restore", "Testing", "Security notes"]],
];

export default function DocsPage() {
  return (
    <div className="container-wide py-16">
      <span className="section-label">Documentation</span>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Everything needed to run your installation</h1>
      <p className="mt-4 max-w-2xl text-ink-600">The full documentation ships in the repository under <code className="rounded bg-ink-100 px-2 py-1 text-sm">docs/</code>. This page points to the live product pages and demo workflows.</p>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {topics.map(([title, items]) => <Card key={title} className="p-6"><h2 className="font-semibold">{title}</h2><ul className="mt-3 space-y-2 text-sm text-ink-600">{items.map((item) => <li key={item}>{item}</li>)}</ul></Card>)}
      </div>
      <div className="mt-8 flex flex-wrap gap-4 text-sm font-semibold text-brand-700"><Link href="/how-it-works" className="underline">Setup walkthrough</Link><Link href="/demo" className="underline">Try the demo</Link><Link href="/p/premium-cotton-t-shirt" className="underline">Public storefront</Link></div>
    </div>
  );
}
