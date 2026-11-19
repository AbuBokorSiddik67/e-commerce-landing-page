import { Card } from "@/components/ui";
import { ContactForm } from "@/components/forms/ContactForm";

export const metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <div className="container-wide py-16">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div><span className="section-label">Get in touch</span><h1 className="mt-3 text-4xl font-semibold tracking-tight">Questions about your installation?</h1><p className="mt-4 text-ink-600">Tell us what you need. Messages are recorded in the installation&apos;s notification inbox and e-mailed to owners when SMTP is configured.</p><Card className="mt-8 p-6"><h2 className="font-semibold">Prefer e-mail?</h2><p className="mt-2 text-sm text-ink-600">The business e-mail configured in dashboard settings is used for customer and contact messages.</p></Card></div>
        <Card className="p-7"><ContactForm /></Card>
      </div>
    </div>
  );
}
