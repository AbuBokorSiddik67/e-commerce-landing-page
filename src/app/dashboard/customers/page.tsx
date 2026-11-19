import Link from "next/link";
import { listCustomers } from "@/services/customers";
import { formatDate, formatMoney, maskPhone } from "@/lib/utils";
import { Alert, Badge, EmptyState, PageHeader, Pagination } from "@/components/ui";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; error?: string; success?: string }> }) {
  const params = await searchParams;
  const result = await listCustomers({ page: Number(params.page ?? 1), search: params.search });
  return (
    <>
      <PageHeader title="Customers" description="Profiles, order history and spending. Phone numbers stay masked in list views." />
      <Alert error={params.error} success={params.success} />
      <form method="get" className="mb-5 flex gap-3"><input className="input max-w-sm" name="search" placeholder="Search name, phone or email" defaultValue={params.search} /><button className="btn-secondary">Search</button></form>
      {result.items.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Paid spending</th><th>Tags</th><th>Joined</th></tr></thead><tbody>{result.items.map((customer) => <tr key={customer.id}><td><Link href={`/dashboard/customers/${customer.id}`} className="font-semibold text-brand-700 hover:underline">{customer.name}</Link><p className="text-xs text-ink-400">{customer.email ?? "—"}</p></td><td>{maskPhone(customer.phone)}</td><td>{customer.orderCount}</td><td>{formatMoney(customer.totalSpending)}</td><td>{((customer.tags as string[]) ?? []).map((tag) => <Badge key={tag}>{tag}</Badge>)}</td><td>{formatDate(customer.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No customers yet" description="Customer profiles are created automatically when an order is placed." />}
      <Pagination page={result.page} pages={result.pages} basePath="/dashboard/customers" />
    </>
  );
}
