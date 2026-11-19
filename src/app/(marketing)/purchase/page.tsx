import { Check, ShieldCheck } from "lucide-react";
import { Card, LinkButton } from "@/components/ui";

export const metadata = { title: "Purchase information", description: "LANDIQ is sold as a one-time software purchase for independent installation." };

export default function PurchasePage() {
  return (
    <div className="container-wide py-16">
      <div className="mx-auto max-w-3xl">
        <span className="section-label">Licensing</span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">One software. One business. One payment.</h1>
        <p className="mt-5 text-lg text-ink-600">LANDIQ is a commercial self-hosted application. There are no subscriptions, per-page fees, workspace tiers or hosted-platform accounts.</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <Card className="p-6"><h2 className="font-semibold">What your purchase includes</h2><ul className="mt-4 space-y-3 text-sm text-ink-600">
            {["Source code and deployment configuration", "Unlimited products, variants and landing pages", "All dashboard modules and staff roles", "Documentation and database migrations"].map((item) => <li key={item} className="flex gap-2"><Check size={16} className="mt-0.5 text-brand-600" />{item}</li>)}
          </ul></Card>
          <Card className="p-6"><h2 className="font-semibold">What is not included</h2><ul className="mt-4 space-y-3 text-sm text-ink-600">
            {["Shared hosting or SaaS workspace", "Merchant accounts for payment providers", "Courier account contracts or API keys", "Third-party subscription fees"].map((item) => <li key={item} className="flex gap-2"><span className="text-amber-500">—</span>{item}</li>)}
          </ul></Card>
        </div>
        <Card className="mt-8 border-brand-100 bg-brand-50/50 p-6">
          <div className="flex gap-3"><ShieldCheck className="shrink-0 text-brand-700" /><div><h2 className="font-semibold">Talk to us about a licence</h2><p className="mt-2 text-sm text-ink-600">Contact details can be configured in the installation&apos;s business settings. Use the contact page to request purchase information, deployment help or a demonstration.</p><div className="mt-4"><LinkButton href="/contact" variant="secondary">Contact us</LinkButton></div></div></div>
        </Card>
      </div>
    </div>
  );
}
