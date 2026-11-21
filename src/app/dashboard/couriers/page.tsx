import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCourierConfigurations, getSetting } from "@/lib/settings";
import { Alert, Badge, Card, PageHeader, ToggleRow } from "@/components/ui";
import { courierConfigAction, deliveryRuleAction, deliverySettingsAction, testCourierAction } from "@/app/actions/settings";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CouriersPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  await requirePageAccess(PERMISSIONS.COURIER_SETTINGS);
  await requirePageAccess(PERMISSIONS.ORDER_VIEW);
  const params = await searchParams;
  const [configs, delivery, rules, shipments] = await Promise.all([
    getCourierConfigurations(),
    getSetting<{ insideCity: number; outsideCity: number; freeAbove: number }>("delivery", { insideCity: 60, outsideCity: 120, freeAbove: 0 }),
    prisma.deliveryRule.findMany({ orderBy: [{ priority: "desc" }, { name: "asc" }] }),
    prisma.courierShipment.findMany({ include: { order: { select: { orderNumber: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return (
    <>
      <PageHeader title="Courier & shipping" description="Provider APIs are optional. Manual courier assignment and delivery rules always work without credentials." />
      <Alert error={params.error} success={params.success} />
      <div className="grid gap-5 xl:grid-cols-3">{configs.map((config) => <Card key={config.code} className="p-6"><div className="flex items-start justify-between"><div><h2 className="font-semibold">{config.name}</h2><p className="text-xs text-ink-500">Optional provider</p></div><Badge tone={config.configured ? "success" : "neutral"}>{config.configured ? "Configured" : "Not configured"}</Badge></div>
        <form action={courierConfigAction} className="mt-4"><input type="hidden" name="code" value={config.code} /><ToggleRow title="Enabled" description="Allow booking and tracking via API."><input type="checkbox" name="enabled" defaultChecked={config.enabled} className="h-5 w-5" /></ToggleRow><ToggleRow title="Visible" description="Show as a customer-facing delivery option."><input type="checkbox" name="visible" defaultChecked={config.visible} className="h-5 w-5" /></ToggleRow><ToggleRow title="Sandbox" description="Use the provider's test environment."><input type="checkbox" name="sandbox" defaultChecked={config.sandbox} className="h-5 w-5" /></ToggleRow><ToggleRow title="Default" description="Preferred provider for new shipments."><input type="checkbox" name="isDefault" defaultChecked={config.isDefault} className="h-5 w-5" /></ToggleRow><div className="mt-3 space-y-3">{config.fields.map((field) => <label key={field} className="block"><span className="label">{field}</span><input className="input" type="password" name={`cred_${field}`} placeholder="Leave blank to keep existing value" autoComplete="off" /></label>)}</div><button className="btn-primary mt-4 w-full">Save courier</button></form>
        <form action={testCourierAction} className="mt-2"><input type="hidden" name="code" value={config.code} /><button className="btn-secondary w-full">Test connection</button></form><p className="mt-3 text-xs text-ink-400">{config.status}{config.lastError ? ` · ${config.lastError.slice(0, 100)}` : ""}</p>
      </Card>)}</div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2"><Card className="p-6"><h2 className="font-semibold">Base delivery charges</h2><form action={deliverySettingsAction} className="mt-4 grid gap-4 sm:grid-cols-3"><label className="block"><span className="label">Inside city (৳)</span><input className="input" type="number" min={0} name="insideCity" defaultValue={delivery.insideCity} /></label><label className="block"><span className="label">Outside city (৳)</span><input className="input" type="number" min={0} name="outsideCity" defaultValue={delivery.outsideCity} /></label><label className="block"><span className="label">Free above (৳, 0 = off)</span><input className="input" type="number" min={0} name="freeAbove" defaultValue={delivery.freeAbove} /></label><div className="sm:col-span-3"><button className="btn-primary">Save charges</button></div></form>
        <h3 className="mt-6 text-sm font-semibold">Custom rules</h3><div className="mt-3 space-y-2">{rules.map((rule) => <div key={rule.id} className="flex justify-between gap-2 rounded-lg bg-ink-50 p-3 text-xs"><span>{rule.name} · {rule.type}: {rule.matchValue} · ৳{rule.charge}</span><form action={deliveryRuleAction}><input type="hidden" name="id" value={rule.id} /><input type="hidden" name="name" value={rule.name} /><input type="hidden" name="type" value={rule.type} /><input type="hidden" name="matchValue" value={rule.matchValue} /><input type="hidden" name="charge" value={rule.charge} /><input type="hidden" name="priority" value={rule.priority} /><input type="hidden" name="isActive" value={rule.isActive ? "on" : ""} /><button className="text-red-600">Delete rule</button></form></div>)}</div>
        <form action={deliveryRuleAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input className="input" name="name" placeholder="Rule name" required /><select className="input" name="type"><option value="district">District</option><option value="area">Area</option><option value="option">Delivery option</option></select><input className="input" name="matchValue" placeholder="Matching value" required /><input className="input" type="number" name="charge" placeholder="Charge (৳)" required /><input className="input" type="number" name="priority" placeholder="Priority" defaultValue={0} /><button className="btn-secondary sm:col-span-2">Add rule</button></form>
      </Card>
      <Card className="p-6"><h2 className="font-semibold">Shipment history</h2><div className="mt-4 space-y-3">{shipments.map((s) => <div key={s.id} className="border-b border-ink-100 pb-3 text-sm last:border-0"><p className="font-medium">{s.order.orderNumber} · {s.providerCode}</p><p className="text-xs text-ink-500">{s.trackingId ?? "—"} · {s.status} · fee ৳{s.cost} · {formatDate(s.createdAt)}</p></div>)}{!shipments.length && <p className="text-sm text-ink-500">No shipments yet. Manual and API shipments appear here.</p>}</div></Card></div>
    </>
  );
}
