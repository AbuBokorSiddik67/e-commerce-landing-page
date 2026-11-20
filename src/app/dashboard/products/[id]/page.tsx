import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/dashboard/ProductForm";
import { Alert, PageHeader } from "@/components/ui";
import { normalizeStoredVariantAttributes, StoredVariantAttributesError } from "@/lib/product-attributes";

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, categories] = await Promise.all([
    prisma.product.findUnique({ where: { id }, include: { category: true, variants: { orderBy: { position: "asc" } }, images: { orderBy: { position: "asc" } } } }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  if (!product) notFound();
  const categoryOptions = product.category && !categories.some((category) => category.id === product.categoryId)
    ? [...categories, product.category]
    : categories;
  const header = <PageHeader title={`Edit ${product.name}`} description="Changes here update the product data used by every landing page." />;

  try {
    const variants = product.variants.map((variant) => ({
      ...variant,
      expectedAttributes: variant.attributes,
      attributes: normalizeStoredVariantAttributes(variant.attributes, { productName: product.name, variantName: variant.name }),
    }));
    return <>{header}<ProductForm product={{
      ...product,
      specifications: product.specifications ?? [],
      attributes: (product.attributes as string[]) ?? [],
      variants,
    }} categories={categoryOptions} /></>;
  } catch (error) {
    if (!(error instanceof StoredVariantAttributesError)) throw error;
    return <>{header}<Alert error={error.message} /><Link href="/dashboard/products" className="btn-secondary">Back to products</Link></>;
  }
}
