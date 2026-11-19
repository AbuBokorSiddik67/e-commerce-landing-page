import { prisma } from "@/lib/prisma";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { deleteCategoryAction, saveCategoryAction } from "@/app/actions/products";

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const params = await searchParams;
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ include: { parent: true, _count: { select: { products: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.product.findMany({ select: { name: true, slug: true, regularPrice: true, salePrice: true, images: { take: 1, orderBy: { position: "asc" } } }, where: { status: "PUBLISHED" }, take: 4 }),
  ]);
  return (
    <>
      <PageHeader title="Categories" description="Organise products. Product attributes stay flexible and are never tied to a category." />
      <Alert error={params.error} success={params.success} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="table-wrap h-fit"><table className="table"><thead><tr><th>Category</th><th>Parent</th><th>Products</th><th>Status</th><th></th></tr></thead><tbody>
          {categories.map((category) => <tr key={category.id}><td><p className="font-semibold">{category.name}</p><p className="text-xs text-ink-400">/{category.slug}</p></td><td>{category.parent?.name ?? "—"}</td><td>{category._count.products}</td><td><Badge tone={category.isActive ? "success" : "neutral"}>{category.isActive ? "Active" : "Hidden"}</Badge></td><td><form action={deleteCategoryAction}><input type="hidden" name="id" value={category.id} /><ConfirmButton message="Delete this category?" className="text-xs font-semibold text-red-600">Delete</ConfirmButton></form></td></tr>)}
        </tbody></table>{!categories.length && <EmptyState title="No categories yet" description="Create your first category with the form." />}</div>
        <Card className="p-6"><h2 className="font-semibold">Add / edit category</h2><form action={saveCategoryAction} className="mt-4 space-y-3">
          <label className="block"><span className="label">Name</span><input className="input" name="name" required /></label>
          <label className="block"><span className="label">Slug</span><input className="input" name="slug" placeholder="auto-generated" /></label>
          <label className="block"><span className="label">Parent category</span><select className="input" name="parentId"><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="block"><span className="label">Description</span><textarea className="textarea" name="description" /></label>
          <label className="block"><span className="label">Image URL</span><input className="input" name="imageUrl" /></label>
          <label className="block"><span className="label">Sort order</span><input className="input" type="number" name="sortOrder" defaultValue={0} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked />Active</label>
          <button className="btn-primary w-full">Save category</button>
        </form></Card>
      </div>
      {products.length > 0 && <div className="mt-8"><h2 className="mb-3 text-sm font-semibold">Published products for related sections</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{products.map((p) => <Card key={p.slug} className="flex items-center gap-3 p-3"><div>{p.images[0] && <img src={p.images[0].url} alt="" className="h-10 w-10 rounded object-cover" />}</div><div><p className="text-sm font-medium">{p.name}</p><p className="text-xs text-ink-500">৳{p.salePrice ?? p.regularPrice}</p></div></Card>)}</div></div>}
    </>
  );
}
