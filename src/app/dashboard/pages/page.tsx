import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listPages } from "@/services/pages";
import { Alert, Badge, EmptyState, LinkButton, PageHeader, Pagination } from "@/components/ui";
import { createPageAction } from "@/app/actions/pages";
import { formatDate } from "@/lib/utils";

export default async function PagesPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; error?: string; success?: string }> }) {
  const params = await searchParams;
  const [result, products] = await Promise.all([
    listPages({ page: Number(params.page ?? 1), search: params.search }),
    prisma.product.findMany({ where: { landingPage: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Landing pages" description="One independent page per product, with its own design, content and SEO." />
      <Alert error={params.error} success={params.success} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <form method="get" className="mb-4 flex gap-3"><input className="input max-w-sm" name="search" placeholder="Search pages" defaultValue={params.search} /><button className="btn-secondary">Search</button></form>
          {result.items.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Page</th><th>Product</th><th>Status</th><th>Modified</th><th></th></tr></thead><tbody>{result.items.map((page) => <tr key={page.id}><td><Link href={`/p/${page.slug}`} target="_blank" className="font-semibold text-brand-700 hover:underline">{page.title}</Link><p className="text-xs text-ink-400">/p/{page.slug}</p></td><td>{page.product.name}</td><td><Badge tone={page.status === "PUBLISHED" ? "success" : page.status === "SCHEDULED" ? "info" : "warning"}>{page.status}</Badge>{page.noIndex && <span className="ml-1 text-xs text-ink-400">noindex</span>}</td><td>{formatDate(page.updatedAt)}</td><td><LinkButton href={`/dashboard/pages/${page.id}/builder`} variant="secondary" className="px-3 py-1.5">Edit</LinkButton></td></tr>)}</tbody></table></div> : <EmptyState title="No landing pages yet" description="Create a page for a product, then use the visual builder." />}
          <Pagination page={result.page} pages={result.pages} basePath="/dashboard/pages" />
        </div>
        <div className="surface h-fit p-6"><h2 className="font-semibold">Create a page</h2>{products.length ? <form action={createPageAction} className="mt-4 space-y-3"><input type="hidden" name="templateCode" value="general" /><input type="hidden" name="status" value="DRAFT" /><label className="block"><span className="label">Product</span><select className="input" name="productId">{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="block"><span className="label">Page title</span><input className="input" name="title" required /></label><label className="block"><span className="label">Slug</span><input className="input" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label><button className="btn-primary w-full">Create draft page</button></form> : <p className="mt-3 text-sm text-ink-500">Every product already has a landing page. Edit one from the table.</p>}<p className="mt-4 text-xs text-ink-400">Choose a template in the builder after creating the page.</p></div>
      </div>
    </>
  );
}
