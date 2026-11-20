import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getPaymentConfigurations } from "@/lib/settings";
import { Alert, Badge, Card, PageHeader, ToggleRow } from "@/components/ui";
import { paymentConfigAction, testPaymentAction } from "@/app/actions/settings";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  await requirePageAccess(PERMISSIONS.PAYMENT_SETTINGS);
  await requirePageAccess(PERMISSIONS.ORDER_VIEW);
  const params = await searchParams;
  const configs = await getPaymentConfigurations();
  const transactions = await prisma.paymentTransaction.findMany({ include: { order: { select: { orderNumber: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
  return (
    <>
      <PageHeader title="Payment methods" description="Each provider is independently configurable. COD never requires credentials or an external API call." />
      <Alert error={params.error} success={params.success} />
      <div className="grid gap-5 xl:grid-cols-2">
        {configs.map((config) => {
          const missing = config.enabled && !config.configured && config.code !== "cod";
          return <Card key={config.code} className="p-6">
            <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{config.name}</h2><p className="mt-1 text-xs text-ink-500">{config.description}</p></div><Badge tone={missing ? "danger" : config.configured ? "success" : "neutral"}>{missing ? "Needs credentials" : config.configured ? "Configured" : "Not configured"}</Badge></div>
            <form action={paymentConfigAction} className="mt-4">
              <input type="hidden" name="code" value={config.code} />
              <ToggleRow title="Enabled" description="Provider may be used for order creation."><input type="checkbox" name="enabled" defaultChecked={config.enabled} className="h-5 w-5" /></ToggleRow>
              <ToggleRow title="Visible at checkout" description="Hidden methods never appear to customers."><input type="checkbox" name="visible" defaultChecked={config.visible} className="h-5 w-5" /></ToggleRow>
              <ToggleRow title="Sandbox / test mode" description="Applies only to providers that support it."><input type="checkbox" name="sandbox" defaultChecked={config.sandbox} className="h-5 w-5" /></ToggleRow>
              <ToggleRow title="Default payment method" description="Preselected when the customer opens checkout."><input type="checkbox" name="isDefault" defaultChecked={config.isDefault} className="h-5 w-5" /></ToggleRow>
              {config.fields.length > 0 && <div className="mt-3 grid gap-3 sm:grid-cols-2">{config.fields.map((field) => <label key={field} className="block"><span className="label">{field}</span><input className="input" type="password" name={`cred_${field}`} placeholder="Leave blank to keep existing value" autoComplete="off" /></label>)}</div>}
              <div className="mt-4 flex flex-wrap items-center gap-2"><button className="btn-primary">Save configuration</button></div>
            </form>
            <form action={testPaymentAction} className="mt-2"><input type="hidden" name="code" value={config.code} /><button className="btn-secondary">Test connection</button></form>
            <p className="mt-3 text-xs text-ink-400">Status: {config.status} {config.lastTestedAt ? `· tested ${formatDate(config.lastTestedAt)}` : ""}{config.lastError ? `· last error: ${config.lastError.slice(0, 120)}` : ""}</p>
            {missing && <p className="alert-error mt-3">This method is enabled but not configured. It is hidden at checkout until credentials are saved.</p>}
          </Card>;
        })}
      </div>
      <Card className="mt-6 p-6"><h2 className="font-semibold">Payment transactions</h2><div className="table-wrap mt-4"><table className="table"><thead><tr><th>Order</th><th>Provider</th><th>Reference</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>{transactions.map((t) => <tr key={t.id}><td>{t.order.orderNumber}</td><td>{t.provider}</td><td className="text-xs">{t.reference ?? "—"}</td><td>৳{t.amount}</td><td><Badge tone={t.status === "PAID" ? "success" : t.status === "FAILED" ? "danger" : "warning"}>{t.status}</Badge></td><td>{formatDate(t.createdAt)}</td></tr>)}</tbody></table>{!transactions.length && <p className="p-4 text-sm text-ink-500">No online payment transactions yet. COD orders do not create gateway transactions.</p>}</div></Card>
    </>
  );
}
