import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import { nonNegativeInt, slugSchema } from "@/lib/validation";

const attributeSchema = z.object({ name: z.string().min(1).max(80), value: z.string().max(120) });

export const variantSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(80).optional().nullable(),
  price: nonNegativeInt.optional().nullable(),
  stock: nonNegativeInt.default(0),
  lowStockThreshold: nonNegativeInt.default(5),
  imageUrl: z.string().max(500).optional().nullable(),
  attributes: z.array(attributeSchema).max(10).default([]),
  isActive: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
});

export const productSchema = z.object({
  name: z.string().trim().min(2).max(180),
  slug: slugSchema.optional(),
  sku: z.string().trim().max(80).optional().nullable(),
  shortDescription: z.string().max(500).optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
  regularPrice: nonNegativeInt,
  salePrice: nonNegativeInt.optional().nullable(),
  categoryId: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  isFeatured: z.boolean().default(false),
  videoUrl: z.string().max(500).optional().nullable(),
  weightGrams: nonNegativeInt.optional().nullable(),
  dimensions: z.object({ length: z.number().optional(), width: z.number().optional(), height: z.number().optional() }).optional().nullable(),
  attributes: z.array(z.string().min(1).max(80)).max(20).default([]),
  specifications: z.array(attributeSchema).max(50).default([]),
  images: z.array(z.object({ url: z.string().max(500), alt: z.string().max(200).optional(), kind: z.enum(["IMAGE", "VIDEO"]).default("IMAGE") })).max(30).default([]),
  variants: z.array(variantSchema).min(1).max(100),
});

export type ProductInput = z.input<typeof productSchema>;

async function ensureUniqueSlug(base: string, excludeId?: string) {
  const candidate = base || "product";
  let slug = candidate;
  for (let i = 0; i < 20; i++) {
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${candidate}-${i + 2}`;
  }
  throw new ConflictError("Could not generate a unique slug");
}

export async function createProduct(input: ProductInput, actorId?: string) {
  const data = productSchema.parse(input);
  const slug = await ensureUniqueSlug(data.slug ? slugify(data.slug) : slugify(data.name));
  const publishedAt = data.status === "PUBLISHED" ? new Date() : null;
  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: data.name, slug, sku: data.sku ?? null,
        shortDescription: data.shortDescription ?? null, description: data.description ?? null,
        regularPrice: data.regularPrice, salePrice: data.salePrice ?? null,
        categoryId: data.categoryId || null, status: data.status, isFeatured: data.isFeatured,
        videoUrl: data.videoUrl || null, weightGrams: data.weightGrams ?? null,
        dimensions: (data.dimensions ?? null) as never,
        attributes: data.attributes as never, specifications: data.specifications as never,
        publishedAt, createdById: actorId ?? null,
        images: { create: data.images.map((image, index) => ({ url: image.url, alt: image.alt ?? null, kind: image.kind, position: index })) },
        variants: {
          create: data.variants.map((variant, index) => ({
            name: variant.name, sku: variant.sku || null, price: variant.price ?? null,
            stock: variant.stock, lowStockThreshold: variant.lowStockThreshold,
            imageUrl: variant.imageUrl || null, attributes: variant.attributes as never,
            isActive: variant.isActive, position: variant.position || index,
          })),
        },
      },
      include: { variants: true, images: true },
    });
    if (data.status === "PUBLISHED") {
      await tx.stockMovement.createMany({
        data: created.variants.filter((v) => v.stock > 0).map((v) => ({
          productId: created.id, variantId: v.id, type: "PURCHASE" as const,
          quantity: v.stock, balanceAfter: v.stock, reason: "Initial stock", createdById: actorId ?? null,
        })),
      });
    }
    return created;
  });
  await audit({ actorId, action: "CREATE_PRODUCT", entity: "Product", entityId: product.id, after: { id: product.id, name: product.name, slug } });
  return product;
}

export async function updateProduct(id: string, input: ProductInput, actorId?: string) {
  const data = productSchema.parse(input);
  const existing = await prisma.product.findUnique({ where: { id }, include: { variants: true } });
  if (!existing) throw new NotFoundError("Product not found");
  const slug = await ensureUniqueSlug(data.slug ? slugify(data.slug) : existing.slug, id);

  const product = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: {
        name: data.name, slug, sku: data.sku ?? null,
        shortDescription: data.shortDescription ?? null, description: data.description ?? null,
        regularPrice: data.regularPrice, salePrice: data.salePrice ?? null,
        categoryId: data.categoryId || null, status: data.status, isFeatured: data.isFeatured,
        videoUrl: data.videoUrl || null, weightGrams: data.weightGrams ?? null,
        dimensions: (data.dimensions ?? null) as never,
        attributes: data.attributes as never, specifications: data.specifications as never,
        publishedAt: data.status === "PUBLISHED" ? (existing.publishedAt ?? new Date()) : null,
        archivedAt: data.status === "ARCHIVED" ? new Date() : null,
      },
    });
    await tx.productImage.deleteMany({ where: { productId: id } });
    await tx.productImage.createMany({
      data: data.images.map((image, index) => ({ productId: id, url: image.url, alt: image.alt ?? null, kind: image.kind, position: index })),
    });
    const keepIds = data.variants.filter((v) => v.id).map((v) => v.id as string);
    await tx.productVariant.deleteMany({ where: { productId: id, id: { notIn: keepIds } } });
    for (const [index, variant] of data.variants.entries()) {
      const values = {
        name: variant.name, sku: variant.sku || null, price: variant.price ?? null,
        stock: variant.stock, lowStockThreshold: variant.lowStockThreshold,
        imageUrl: variant.imageUrl || null, attributes: variant.attributes as never,
        isActive: variant.isActive, position: variant.position || index,
      };
      if (variant.id && keepIds.includes(variant.id)) {
        await tx.productVariant.update({ where: { id: variant.id }, data: values });
        const oldVariant = existing.variants.find((v) => v.id === variant.id);
        if (oldVariant && oldVariant.stock !== variant.stock) {
          await tx.stockMovement.create({
            data: {
              productId: id, variantId: variant.id, type: "ADJUSTMENT",
              quantity: variant.stock - oldVariant.stock, balanceAfter: variant.stock,
              reason: "Stock changed in product editor", createdById: actorId ?? null,
            },
          });
        }
      } else {
        const createdVariant = await tx.productVariant.create({ data: { productId: id, ...values } });
        if (createdVariant.stock > 0) {
          await tx.stockMovement.create({
            data: {
              productId: id, variantId: createdVariant.id, type: "PURCHASE", quantity: createdVariant.stock,
              balanceAfter: createdVariant.stock, reason: "New variant stock", createdById: actorId ?? null,
            },
          });
        }
      }
    }
    return updated;
  });
  await audit({ actorId, action: "UPDATE_PRODUCT", entity: "Product", entityId: id, before: existing, after: product });
  return product;
}

export async function deleteProduct(id: string, actorId?: string) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new NotFoundError("Product not found");
  const openOrders = await prisma.order.count({ where: { productId: id, status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "OUT_FOR_DELIVERY"] } } });
  if (openOrders > 0) throw new ConflictError("Cannot delete a product with open orders; archive it instead");
  await prisma.product.delete({ where: { id } });
  await audit({ actorId, action: "DELETE_PRODUCT", entity: "Product", entityId: id, before: product });
}

export async function duplicateProduct(id: string, actorId?: string) {
  const source = await prisma.product.findUnique({ where: { id }, include: { variants: true, images: true } });
  if (!source) throw new NotFoundError("Product not found");
  return createProduct({
    name: `${source.name} (Copy)`,
    sku: null,
    shortDescription: source.shortDescription,
    description: source.description,
    regularPrice: source.regularPrice,
    salePrice: source.salePrice,
    categoryId: source.categoryId,
    status: "DRAFT",
    isFeatured: false,
    videoUrl: source.videoUrl,
    weightGrams: source.weightGrams,
    dimensions: (source.dimensions as { length?: number; width?: number; height?: number }) ?? null,
    attributes: (source.attributes as string[]) ?? [],
    specifications: (source.specifications as { name: string; value: string }[]) ?? [],
    images: source.images.map((image) => ({ url: image.url, alt: image.alt ?? undefined, kind: image.kind as "IMAGE" | "VIDEO" })),
    variants: source.variants.map((variant, index) => ({
      name: variant.name, sku: null, price: variant.price, stock: 0,
      lowStockThreshold: variant.lowStockThreshold, imageUrl: variant.imageUrl,
      attributes: (variant.attributes as { name: string; value: string }[]) ?? [], isActive: variant.isActive, position: index,
    })),
  }, actorId);
}

export async function setProductStatus(id: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED", actorId?: string) {
  const existing = await prisma.product.findUniqueOrThrow({ where: { id }, include: { variants: true } });
  const product = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: { status, publishedAt: status === "PUBLISHED" ? (existing.publishedAt ?? new Date()) : null, archivedAt: status === "ARCHIVED" ? new Date() : null },
    });
    if (status === "PUBLISHED" && existing.status !== "PUBLISHED") {
      for (const variant of existing.variants) {
        if (variant.stock <= 0) continue;
        const alreadyRecorded = await tx.stockMovement.count({ where: { variantId: variant.id, type: "PURCHASE" } });
        if (alreadyRecorded) continue;
        await tx.stockMovement.create({
          data: {
            productId: id, variantId: variant.id, type: "PURCHASE", quantity: variant.stock,
            balanceAfter: variant.stock, reason: "Initial stock on publish", createdById: actorId ?? null,
          },
        });
      }
    }
    return updated;
  });
  await audit({ actorId, action: "SET_PRODUCT_STATUS", entity: "Product", entityId: id, after: { status } });
  return product;
}

export async function listProducts(options: { search?: string; status?: string; categoryId?: string; page?: number; perPage?: number } = {}) {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 20));
  const where = {
    ...(options.search ? { OR: [
      { name: { contains: options.search, mode: "insensitive" as const } },
      { sku: { contains: options.search, mode: "insensitive" as const } },
    ] } : {}),
    ...(options.status ? { status: options.status as "DRAFT" | "PUBLISHED" | "ARCHIVED" } : {}),
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where, include: { category: true, images: { orderBy: { position: "asc" }, take: 1 }, variants: true, landingPage: true },
      orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage,
    }),
    prisma.product.count({ where }),
  ]);
  return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
}
