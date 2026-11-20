import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/dashboard/ProductForm";
import { PageHeader } from "@/components/ui";
import { variantAttributesSchema } from "@/lib/product-attributes";

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, categories] = await Promise.all([
    prisma.product.findUnique({ where: { id }, include: { variants: { orderBy: { position: "asc" } }, images: { orderBy: { position: "asc" } } } }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  if (!product) notFound();
  return <><PageHeader title={`Edit ${product.name}`} description="Changes here update the product data used by every landing page." /><ProductForm product={{
    ...product,
    specifications: product.specifications ?? [],
    attributes: (product.attributes as string[]) ?? [],
    variants: product.variants.map((variant) => ({ ...variant, attributes: variantAttributesSchema.parse(variant.attributes) })),
  }} categories={categories} /></>;
}
