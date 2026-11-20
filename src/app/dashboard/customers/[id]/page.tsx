import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { getCustomer } from "@/services/customers";
import { formatDate, formatMoney, maskPhone } from "@/lib/utils";
import { Badge, Card, PageHeader } from "@/components/ui";
import { customerAction } from "@/app/actions/catalog";

export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ success?: string; error?: string }> }) {
  await requirePageAccess(PERMISSIONS.CUSTOMER_VIEW);
  await requirePageAccess(PERMISSIONS.ORDER_VIEW);
  const { id } = await params;
  const query = await searchParams;
  const customer = await getCustomer(id).catch(() => null);
  if (!customer) notFound();
  return (
    <>
      <PageHeader title={customer.name} description={`Customer since ${formatDate(customer.createdAt)}`} />
      {query.error && <div className="alert-error mb-5">{query.error}</div>}{query.success && <div className="alert-success mb-5">{query.success}</div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6"><Card className="p-6"><h2 className="font-semibold">Order history</h2>{customer.orders.length ? <div className="table-wrap mt-4"><table className="table"><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>{customer.orders.map((order) => <tr key={order.id}><td><a href={`/dashboard/orders/${order.id}`} className="font-semibold text-brand-700">{order.orderNumber}</a></td><td>{formatDate(order.createdAt)}</td><td>{order.items.map((i) => `${i.name} × ${i.quantity}`).join(", ")}</td><td>{formatMoney(order.total)}</td><td><Badge tone={order.status === "DELIVERED" ? "success" : "info"}>{order.status}</Badge></td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-ink-500">No orders yet.</p>}</Card></div>
        <div className="space-y-6"><Card className="p-6"><h2 className="font-semibold">Contact & addresses</h2><div className="mt-3 space-y-2 text-sm"><p>Phone: {maskPhone(customer.phone)}</p><p>Email: {customer.email ?? "—"}</p>{customer.addresses.map((a) => <p key={a.id}>{a.address}, {a.district} {a.area ? `· ${a.area}` : ""}</p>)}</div><p className="mt-4 text-xs text-ink-400">Full phone and address are visible only to staff with customer access.</p></Card><Card className="p-6"><h2 className="font-semibold">Edit profile</h2><form action={customerAction} className="mt-4 space-y-3"><input type="hidden" name="id" value={customer.id} /><label className="block"><span className="label">Name</span><input className="input" name="name" defaultValue={customer.name} /></label><label className="block"><span className="label">Email</span><input className="input" name="email" defaultValue={customer.email ?? ""} /></label><label className="block"><span className="label">Tags (comma separated)</span><input className="input" name="tags" defaultValue={(customer.tags as string[]).join(", ")} /></label><label className="block"><span className="label">Internal notes</span><textarea className="textarea" name="notes" defaultValue={customer.notes ?? ""} /></label><button className="btn-primary w-full">Save profile</button></form></Card></div>
      </div>
    </>
  );
}
