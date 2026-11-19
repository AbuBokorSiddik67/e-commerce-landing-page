import Link from "next/link";
import { Card } from "@/components/ui";

const steps = [
  { n: "01", title: "Deploy your installation", text: "Point a domain at your server, create an empty PostgreSQL database and set the environment variables. `npm run prisma:deploy` creates the schema and `npm run db:seed` creates the first owner account." },
  { n: "02", title: "Set the business rules", text: "Add your logo, contact details, policies, delivery charges and the payment methods you actually want to offer. COD works immediately with no credentials." },
  { n: "03", title: "Create products and pages", text: "Add products with variants and stock. Choose a template, edit the sections, preview at three widths and publish. Each product gets its own /p/ link." },
  { n: "04", title: "Receive and fulfil orders", text: "Customers submit orders with their details. Confirm by phone, assign a courier manually or book through an enabled provider, and update delivery status." },
  { n: "05", title: "Close the loop", text: "Record COD collection and settlement separately, handle returns and refunds, review measured analytics and keep staff access under control." },
];

export default function HowItWorks() {
  return (
    <div className="container-wide py-16">
      <span className="section-label">Implementation path</span>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">From installation to first order</h1>
      <div className="mt-12 space-y-4">
        {steps.map((step) => <Card key={step.n} className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start"><span className="font-display text-3xl text-brand-600">{step.n}</span><div><h2 className="text-lg font-semibold">{step.title}</h2><p className="mt-2 text-sm leading-relaxed text-ink-600">{step.text}</p></div></Card>)}
      </div>
      <p className="mt-8 text-sm text-ink-500">Full commands and configuration: <Link href="/docs" className="font-semibold text-brand-700 underline">Documentation</Link></p>
    </div>
  );
}
