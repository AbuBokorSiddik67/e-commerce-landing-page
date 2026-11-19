export const metadata = { title: "Terms and conditions" };

export default function TermsPage() {
  return (
    <div className="container-wide max-w-3xl py-16">
      <span className="section-label">Legal</span><h1 className="mt-3 text-4xl font-semibold tracking-tight">Terms and conditions</h1>
      <div className="prose-body mt-8 space-y-5 text-ink-600">
        <p>These terms are a template for the information an individual LANDIQ installation can publish. The store owner&apos;s configured terms in dashboard settings take precedence for that business.</p>
        <h2 className="text-lg font-semibold text-ink-900">Orders</h2><p>An order is a request to purchase. The business confirms availability, price and delivery details before shipping. Cash on Delivery orders are not considered paid until cash is collected and recorded.</p>
        <h2 className="text-lg font-semibold text-ink-900">Pricing and delivery</h2><p>Prices and delivery charges are shown before submission. Additional charges are never added without disclosure. Delivery times are estimates and depend on location and courier availability.</p>
        <h2 className="text-lg font-semibold text-ink-900">Returns</h2><p>Return eligibility, inspection and refund handling follow the return policy configured by the business. An internal refund record is not a claim that a payment provider has returned funds.</p>
        <h2 className="text-lg font-semibold text-ink-900">Software licence</h2><p>LANDIQ is licensed per independent installation for one business. It is not a multi-tenant SaaS platform and does not include third-party merchant accounts.</p>
      </div>
    </div>
  );
}
