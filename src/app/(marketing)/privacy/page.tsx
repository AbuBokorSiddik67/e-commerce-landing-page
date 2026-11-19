export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <div className="container-wide max-w-3xl py-16">
      <span className="section-label">Legal</span><h1 className="mt-3 text-4xl font-semibold tracking-tight">Privacy policy</h1>
      <div className="prose-body mt-8 space-y-5 text-ink-600">
        <p>This policy describes how a LANDIQ installation handles information. Each business owner configures their own policies in dashboard settings; the text shown on public pages comes from that installation.</p>
        <h2 className="text-lg font-semibold text-ink-900">Information we collect</h2>
        <p>When you place an order we collect the name, phone number, optional e-mail address and delivery address you provide, along with the items, quantity and payment method selected. Payment providers receive only the information required to process a transaction you choose.</p>
        <h2 className="text-lg font-semibold text-ink-900">How it is used</h2>
        <p>Order information is used to confirm, fulfil and track your order, handle returns and meet legal obligations. Analytics events record page views and CTA clicks with a pseudonymous visitor identifier; they do not contain your address.</p>
        <h2 className="text-lg font-semibold text-ink-900">Tracking links</h2>
        <p>Order tracking links use a random, unpredictable token. Public tracking pages never show a complete phone number or full address. Keep your tracking link private.</p>
        <h2 className="text-lg font-semibold text-ink-900">Your choices</h2>
        <p>Contact the business that operates the storefront to request access to, correction of, or deletion of your information, subject to record-keeping requirements.</p>
      </div>
    </div>
  );
}
