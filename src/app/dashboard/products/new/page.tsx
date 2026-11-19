import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/dashboard/ProductForm";
import { PageHeader } from "@/components/ui";

export default async function NewProduct() {
  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return <><PageHeader title="New product" description="Add the details now; build the landing page afterwards." /><ProductForm categories={categories} /></>;
}
