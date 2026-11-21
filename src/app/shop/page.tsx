import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils";
import { processScheduledPages } from "@/services/pages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Browse products" };

export default async function ShopPage() {
  await processScheduledPages();
  const pages = await prisma.landingPage.findMany({
    where: { status: "PUBLISHED", product: { status: "PUBLISHED" } },
    select: { slug: true, product: { select: { name: true, shortDescription: true, regularPrice: true, salePrice: true,
      variants: { where: { isActive: true }, select: { stock: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return <main className="container-wide max-w-6xl py-12">
    <nav className="mb-6 flex justify-between text-sm font-semibold"><Link href="/" className="text-ink-500">← Home</Link><Link href="/cart" className="text-brand-700 underline">View cart</Link></nav>
    <h1 className="text-3xl font-semibold">Browse products</h1>
    <p className="mt-2 text-sm text-ink-500">Choose a product to see its details and order.</p>
    {!pages.length && <p className="mt-8 text-ink-500">No products are available yet.</p>}
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pages.map((page) => <Link key={page.slug} href={`/p/${encodeURIComponent(page.slug)}`} className="surface block p-6 transition hover:border-brand-300">
      <h2 className="text-lg font-semibold">{page.product.name}</h2>
      {page.product.shortDescription && <p className="mt-2 text-sm text-ink-500">{page.product.shortDescription}</p>}
      <p className="mt-4 font-semibold text-brand-700">{formatMoney(page.product.salePrice ?? page.product.regularPrice)}</p>
      <p className="mt-2 text-xs text-ink-500">{page.product.variants.some((variant) => variant.stock > 0) ? "View details" : "Out of stock"}</p>
    </Link>)}</div>
  </main>;
}
