import { prisma } from "@/lib/prisma";
import { integrationAction } from "@/app/actions/settings";
import { Alert, Card, PageHeader, ToggleRow } from "@/components/ui";

const forms = [
  { code: "meta_pixel", name: "Meta Pixel & Conversions API", fields: [{ key: "pixelId", label: "Pixel ID" }, { key: "capiEnabled", label: "Enable server-side CAPI (true/false)" }], note: "CAPI access token is set via META_CAPI_ACCESS_TOKEN environment variable and never shown here." },
  { code: "google_analytics", name: "Google Analytics", fields: [{ key: "measurementId", label: "Measurement ID" }], note: "PageView and InitiateCheckout events are sent from the published page." },
  { code: "google_tag_manager", name: "Google Tag Manager", fields: [{ key: "containerId", label: "Container ID" }], note: "GTM is injected only on public landing pages when enabled." },
];

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const params = await searchParams;
  const integrations = await prisma.integration.findMany();
  return (
    <>
      <PageHeader title="Marketing integrations" description="Each integration is optional and independently switchable. Secrets stay on the server." />
      <Alert error={params.error} success={params.success} />
      <div className="grid gap-5 lg:grid-cols-3">{forms.map((form) => {
        const row = integrations.find((r) => r.code === form.code);
        const config = (row?.config ?? {}) as Record<string, string>;
        return <Card key={form.code} className="p-6"><div className="flex items-center justify-between"><h2 className="font-semibold">{form.name}</h2><span className="badge bg-ink-100 text-ink-600">{row?.enabled ? "Enabled" : "Disabled"}</span></div><form action={integrationAction} className="mt-4"><input type="hidden" name="code" value={form.code} /><input type="hidden" name="name" value={form.name} /><ToggleRow title="Enabled" description="Inject scripts on public pages."><input type="checkbox" name="enabled" defaultChecked={row?.enabled} className="h-5 w-5" /></ToggleRow><div className="mt-3 space-y-3">{form.fields.map((field) => <label key={field.key} className="block"><span className="label">{field.label}</span><input className="input" name={`cfg_${field.key}`} defaultValue={config[field.key] ?? ""} /></label>)}</div><button className="btn-primary mt-4 w-full">Save integration</button></form><p className="mt-3 text-xs text-ink-400">{form.note}</p></Card>;
      })}</div>
      <Card className="mt-6 p-6"><h2 className="font-semibold">Event definitions</h2><ul className="mt-3 space-y-2 text-sm text-ink-600"><li><strong>PageView / ViewContent:</strong> sent when a published landing page loads.</li><li><strong>InitiateCheckout:</strong> sent when a customer presses Order Now or submits the order form.</li><li><strong>Purchase:</strong> sent server-side only after verified online payment when CAPI is configured, with an order-based deduplication ID. COD orders do not generate a paid Purchase event.</li></ul></Card>
    </>
  );
}
