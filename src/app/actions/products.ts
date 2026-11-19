"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { ConflictError } from "@/lib/errors";
import { createProduct, deleteProduct, duplicateProduct, setProductStatus, updateProduct } from "@/services/products";
import { setStock } from "@/services/inventory";
import { bool, finish, jsonField, num, optionalStr, str } from "./helpers";

function productInput(formData: FormData) {
  return {
    name: str(formData, "name"),
    slug: str(formData, "slug") || undefined,
    sku: optionalStr(formData, "sku"),
    shortDescription: optionalStr(formData, "shortDescription"),
    description: optionalStr(formData, "description"),
    regularPrice: num(formData, "regularPrice"),
    salePrice: optionalStr(formData, "salePrice") ? num(formData, "salePrice") : null,
    categoryId: optionalStr(formData, "categoryId"),
    status: str(formData, "status", "DRAFT") as "DRAFT" | "PUBLISHED" | "ARCHIVED",
    isFeatured: bool(formData, "isFeatured"),
    videoUrl: optionalStr(formData, "videoUrl"),
    weightGrams: optionalStr(formData, "weightGrams") ? num(formData, "weightGrams") : null,
    dimensions: jsonField<{ length?: number; width?: number; height?: number } | null>(formData, "dimensions", null),
    attributes: jsonField<string[]>(formData, "attributes", []),
    specifications: jsonField<{ name: string; value: string }[]>(formData, "specifications", []),
    images: jsonField<{ url: string; alt?: string; kind: "IMAGE" | "VIDEO" }[]>(formData, "images", []),
    variants: jsonField<Array<{ id?: string; name: string; sku?: string; price?: number | null; stock: number; lowStockThreshold: number; imageUrl?: string; attributes: Array<{ name: string; value: string }>; isActive: boolean; position: number }>>(formData, "variants", []),
  };
}

export async function saveProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.PRODUCT_WRITE);
  const id = str(formData, "id");
  const input = productInput(formData);
  await finish("/dashboard/products", async () => {
    if (id) await updateProduct(id, input, user.id);
    else {
      const product = await createProduct(input, user.id);
      // A product always gets an editable landing page draft.
      await prisma.landingPage.create({
        data: {
          productId: product.id, slug: product.slug, title: product.name,
          status: "DRAFT", templateCode: "general", theme: {}, seo: {}, analytics: {}, settings: {},
        },
      });
    }
  }, id ? "Product updated" : "Product created");
}

export async function deleteProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.PRODUCT_DELETE);
  await finish("/dashboard/products", () => deleteProduct(str(formData, "id"), user.id), "Product deleted");
}

export async function duplicateProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.PRODUCT_WRITE);
  await finish("/dashboard/products", async () => {
    await duplicateProduct(str(formData, "id"), user.id);
  }, "Product duplicated as a draft");
}

export async function productStatusAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.PRODUCT_WRITE);
  await finish("/dashboard/products", () => setProductStatus(str(formData, "id"), str(formData, "status") as "DRAFT" | "PUBLISHED" | "ARCHIVED", user.id), "Status updated");
}

export async function saveCategoryAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.CATEGORY_WRITE);
  await finish("/dashboard/categories", async () => {
    const id = str(formData, "id");
    const data = {
      name: str(formData, "name"), slug: slugify(str(formData, "slug") || str(formData, "name")),
      description: optionalStr(formData, "description"), parentId: optionalStr(formData, "parentId"),
      imageUrl: optionalStr(formData, "imageUrl"), isActive: bool(formData, "isActive"),
      sortOrder: num(formData, "sortOrder"),
    };
    if (id) await prisma.category.update({ where: { id }, data });
    else await prisma.category.create({ data });
  });
}

export async function deleteCategoryAction(formData: FormData) {
  await requirePermission(PERMISSIONS.CATEGORY_WRITE);
  await finish("/dashboard/categories", async () => {
    const id = str(formData, "id");
    const count = await prisma.product.count({ where: { categoryId: id } });
    if (count) throw new ConflictError("Move products out of this category before deleting it");
    await prisma.category.delete({ where: { id } });
  }, "Category deleted");
}

export async function setStockAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.INVENTORY_WRITE);
  await finish("/dashboard/inventory", () => setStock(str(formData, "variantId"), num(formData, "stock"), str(formData, "reason", "Manual adjustment"), user.id), "Stock adjusted");
}

export async function deleteMediaAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.MEDIA_WRITE);
  const { deleteMedia } = await import("@/services/media");
  await finish("/dashboard/media", () => deleteMedia(str(formData, "id"), user.id), "Media deleted");
}
