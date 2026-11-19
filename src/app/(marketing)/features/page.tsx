import { Card } from "@/components/ui";

const groups = [
  { title: "Storefront management", items: ["Unlimited products, categories and variants", "Flexible attributes for fashion, electronics or any category", "22-section visual page builder with reusable templates", "Per-page SEO, structured data, sitemap and redirects", "Mobile-first customer experience with variant and quantity selectors"] },
  { title: "Commerce operations", items: ["Cash on Delivery with no gateway dependency", "Optional SSLCommerz, bKash and Nagad with per-provider switches", "Optional Pathao, Steadfast and REDX plus full manual courier mode", "Delivery charges by option, district, area or custom rules", "Separate delivery, financial and COD settlement states"] },
  { title: "Customer experience", items: ["Secure token-based tracking without customer accounts", "Coupons, verified-purchase reviews and order history", "Order status timeline with verified courier vs manual events", "Returns, inspections, restocking and recorded refunds", "Notification channels with delivery logs"] },
  { title: "Business control", items: ["Owner, Admin, Manager and specialised staff roles", "Server-side permission enforcement and audit logs", "Customers, inventory movements and low-stock alerts", "Measured analytics and optional marketing integrations", "Encrypted provider credentials and backup tooling"] },
];

export const metadata = { title: "Features", description: "Explore LANDIQ features for products, landing pages, orders, COD and optional integrations." };

export default function FeaturesPage() {
  return (
    <div className="container-wide py-16">
      <span className="section-label">Feature overview</span>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Built around how independent businesses actually sell</h1>
      <p className="mt-4 max-w-2xl text-ink-500">No artificial limits, no forced third-party accounts. Every capability belongs to your own installation.</p>
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {groups.map((group) => <Card key={group.title} className="p-7"><h2 className="text-lg font-semibold">{group.title}</h2><ul className="mt-4 space-y-3">{group.items.map((item) => <li key={item} className="flex gap-3 text-sm text-ink-600"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />{item}</li>)}</ul></Card>)}
      </div>
    </div>
  );
}
