import { prisma } from "@/lib/prisma";
import { getBusinessSettings } from "@/lib/settings";
import { businessSettingsAction } from "@/app/actions/settings";
import { createRedirectAction, deleteRedirectAction } from "@/app/actions/pages";
import { Alert, Card, Field, PageHeader } from "@/components/ui";

export default async function BusinessSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const params = await searchParams;
  const [settings, redirects] = await Promise.all([getBusinessSettings(), prisma.redirect.findMany({ orderBy: { fromPath: "asc" } })]);
  const social = settings.socialLinks as Record<string, string>;
  return (
    <>
      <PageHeader title="Business settings" description="Global branding, legal content and redirect rules for this installation." />
      <Alert error={params.error} success={params.success} />
      <form action={businessSettingsAction} className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-6"><h2 className="font-semibold">Business profile</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Business name" name="name" required><input className="input" name="name" defaultValue={settings.name} required /></Field><Field label="Legal name" name="legalName"><input className="input" name="legalName" defaultValue={settings.legalName ?? ""} /></Field><Field label="Email" name="email"><input className="input" type="email" name="email" defaultValue={settings.email ?? ""} /></Field><Field label="Phone" name="phone"><input className="input" name="phone" defaultValue={settings.phone ?? ""} /></Field><Field label="Address" name="address"><input className="input" name="address" defaultValue={settings.address ?? ""} /></Field><Field label="Brand colour" name="brandColor"><input className="input" type="color" name="brandColor" defaultValue={settings.brandColor} /></Field><Field label="Logo URL" name="logoUrl"><input className="input" name="logoUrl" defaultValue={settings.logoUrl ?? ""} /></Field><Field label="Favicon URL" name="faviconUrl"><input className="input" name="faviconUrl" defaultValue={settings.faviconUrl ?? ""} /></Field><Field label="Currency" name="currency"><input className="input" name="currency" defaultValue={settings.currency} /></Field><Field label="Time zone" name="timezone"><input className="input" name="timezone" defaultValue={settings.timezone} /></Field></div><div className="mt-4"><Field label="Description" name="description"><textarea className="textarea" name="description" defaultValue={settings.description ?? ""} /></Field></div><div className="mt-4"><Field label="Social links (JSON)" name="socialLinks" hint='Example: {"facebook":"https://…","youtube":"https://…"}'><textarea className="textarea" name="socialLinks" defaultValue={JSON.stringify(social, null, 2)} /></Field></div></Card>
          <Card className="p-6"><h2 className="font-semibold">Policies & delivery information</h2><div className="mt-4 space-y-4"><Field label="Delivery information" name="deliveryInfo"><textarea className="textarea" name="deliveryInfo" defaultValue={settings.deliveryInfo ?? ""} /></Field><Field label="Return policy" name="returnPolicy"><textarea className="textarea" name="returnPolicy" defaultValue={settings.returnPolicy ?? ""} /></Field><Field label="Privacy policy" name="privacyPolicy"><textarea className="textarea" name="privacyPolicy" defaultValue={settings.privacyPolicy ?? ""} /></Field><Field label="Terms and conditions" name="terms"><textarea className="textarea" name="terms" defaultValue={settings.terms ?? ""} /></Field></div></Card>
        </div>
        <div className="space-y-6"><Card className="p-6"><h2 className="font-semibold">Save</h2><p className="mt-2 text-xs text-ink-500">Individual landing pages can override theme and SEO, but inherit these business details.</p><button className="btn-primary mt-4 w-full">Save settings</button></Card>
          <Card className="p-6"><h2 className="font-semibold">Redirects</h2><form action={createRedirectAction} className="mt-4 space-y-3"><input className="input" name="fromPath" placeholder="From path (/old-page)" required /><input className="input" name="toPath" placeholder="To path (/p/new-page)" required /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="permanent" defaultChecked />Permanent (301)</label><button className="btn-secondary w-full">Add redirect</button></form><div className="mt-4 space-y-2">{redirects.map((r) => <div key={r.id} className="flex justify-between gap-2 text-xs"><span>{r.fromPath} → {r.toPath}</span><form action={deleteRedirectAction}><input type="hidden" name="id" value={r.id} /><button className="text-red-600">Remove</button></form></div>)}</div></Card>
        </div>
      </form>
    </>
  );
}
