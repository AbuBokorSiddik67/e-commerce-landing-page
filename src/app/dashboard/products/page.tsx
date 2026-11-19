import Link from "next/link";
import { Copy, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { listProducts } from "@/services/products";
import { formatMoney } from "@/lib/utils";
import { Alert, Badge, EmptyState, LinkButton, PageHeader, Pagination } from "@/components/ui";
import { deleteProductAction, duplicateProductAction, productStatusAction } from "@/app/actions/products";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; status?: string; error?: string; success?: string }> }) {
  const params = await searchParams;
  const result = await listProducts({ page: Number(params.page ?? 1), search: params.search, status: params.status });
  return (
    <>
      <PageHeader title="Products" description="Create products, variants and the content your landing pages use." action={<LinkButton href="/dashboard/products/new">New product</LinkButton>} />
      <Alert error={params.error} success={params.success} />
      <form className="mb-5 flex flex-wrap gap-3" method="get">
        <input className="input max-w-xs" name="search" placeholder="Search products or SKU" defaultValue={params.search} />
        <select className="input max-w-xs" name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select>
        <button className="btn-secondary">Filter</button>
      </form>
      {result.items.length === 0 ? <EmptyState title="No products found" description="Add your first product to start building landing pages." action={<LinkButton href="/dashboard/products/new">New product</LinkButton>} /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Variants</th><th>Stock</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>
          {result.items.map((product) => (
            <tr key={product.id}>
              <td><div className="flex items-center gap-3">{product.images[0] && <img src={product.images[0].url} alt="" className="h-10 w-10 rounded-lg object-cover" />}<div><Link href={`/dashboard/products/${product.id}`} className="font-semibold text-ink-800 hover:text-brand-700">{product.name}</Link><p className="text-xs text-ink-400">/{product.slug}</p></div></div></td>
              <td className="text-ink-500">{product.sku ?? "—"}</td>
              <td>{formatMoney(product.salePrice ?? product.regularPrice)}{product.salePrice && <span className="ml-2 text-xs text-ink-400 line-through">{formatMoney(product.regularPrice)}</span>}</td>
              <td>{product.variants.length}</td>
              <td>{product.variants.reduce((sum, v) => sum + v.stock, 0)}</td>
              <td><Badge tone={product.status === "PUBLISHED" ? "success" : product.status === "ARCHIVED" ? "neutral" : "warning"}>{product.status}</Badge></td>
              <td><div className="flex justify-end gap-1">
                <Link href={`/p/${product.slug}`} target="_blank" className="btn-ghost px-2 py-1" title="View page"><Eye size={15} /></Link>
                <form action={productStatusAction}><input type="hidden" name="id" value={product.id} /><input type="hidden" name="status" value={product.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED"} /><button className="btn-ghost px-2 py-1" title="Toggle publish">{product.status === "PUBLISHED" ? <EyeOff size={15} /> : <Eye size={15} />}</button></form>
                <form action={duplicateProductAction}><input type="hidden" name="id" value={product.id} /><button className="btn-ghost px-2 py-1" title="Duplicate"><Copy size={15} /></button></form>
                <Link href={`/dashboard/products/${product.id}`} className="btn-ghost px-2 py-1" title="Edit"><Pencil size={15} /></Link>
                <form action={deleteProductAction}><input type="hidden" name="id" value={product.id} /><ConfirmButton message="Delete this product? Open orders prevent deletion." className="btn-ghost px-2 py-1 text-red-600"><Trash2 size={15} /></ConfirmButton></form>
              </div></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      <Pagination page={result.page} pages={result.pages} basePath={`/dashboard/products?search=${params.search ?? ""}&status=${params.status ?? ""}`} />
      <p className="mt-4 text-xs text-ink-400">{result.total} product(s) in this installation. Capacity depends on your hosting and database.</p>
    </>
  );
}
