import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import { nonNegativeInt, slugSchema } from "@/lib/validation";
import { attributeSchema, normalizeStoredVariantAttributes, variantAttributesSchema } from "@/lib/product-attributes";
import { compareStableIds } from "@/lib/inventory-invariants";

const stockSchema = z.number().int().min(0).max(2_147_483_647);

export const variantSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(80).optional().nullable(),
  price: nonNegativeInt.optional().nullable(),
  stock: stockSchema,
  lowStockThreshold: nonNegativeInt.default(5),
  imageUrl: z.string().max(500).optional().nullable(),
  // Absence means "leave an existing variant untouched"; [] means "clear".
  attributes: variantAttributesSchema.optional(),
  // These are edit preconditions, not attributes to persist.
  expectedStock: stockSchema.optional(),
  expectedMovementCount: z.number().int().nonnegative().safe().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  expectedAttributes: z.unknown().optional(),
  isActive: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
}).strict();

export const productSchema = z.object({
  name: z.string().trim().min(2).max(180),
  slug: slugSchema.optional(),
  sku: z.string().trim().max(80).optional().nullable(),
  shortDescription: z.string().max(500).optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
  regularPrice: nonNegativeInt,
  salePrice: nonNegativeInt.optional().nullable(),
  categoryId: z.string().min(1).optional().nullable(),
  expectedCategoryId: z.string().min(1).optional().nullable(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  // Status is an edit precondition, not persisted as a separate field.
  expectedStatus: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  isFeatured: z.boolean().default(false),
  videoUrl: z.string().max(500).optional().nullable(),
  weightGrams: nonNegativeInt.optional().nullable(),
  dimensions: z.object({
    length: z.number().finite().nonnegative().optional(),
    width: z.number().finite().nonnegative().optional(),
    height: z.number().finite().nonnegative().optional(),
  }).strict().optional().nullable(),
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

async function requireActiveCategory(tx: Prisma.TransactionClient, categoryId: string | null | undefined) {
  if (!categoryId) return;
  // Hold a share lock through the product transaction. A concurrent category
  // deactivation/deletion must finish either before this check or after the
  // assignment commits; a plain read would leave a check-then-write race.
  const [category] = await tx.$queryRaw<Array<{ isActive: boolean }>>`
    SELECT "isActive" FROM "Category" WHERE "id" = ${categoryId} FOR SHARE
  `;
  if (!category?.isActive) throw new ConflictError("Choose an active category");
}

export async function createProduct(input: ProductInput, actorId?: string) {
  const data = productSchema.parse(input);
  if (data.expectedCategoryId !== undefined || data.expectedStatus !== undefined) {
    throw new ConflictError("A new product cannot include an existing category or status snapshot");
  }
  const variants = data.variants.map((variant) => {
    if (variant.id || variant.expectedStock !== undefined || variant.expectedMovementCount !== undefined
      || variant.expectedUpdatedAt !== undefined || variant.expectedAttributes !== undefined) {
      throw new ConflictError("A new product cannot reference an existing variant");
    }
    if (variant.attributes === undefined) throw new ConflictError(`New variant "${variant.name}" must include an attribute array`);
    return { ...variant, attributes: variant.attributes };
  });
  const slug = await ensureUniqueSlug(data.slug ? slugify(data.slug) : slugify(data.name));
  const publishedAt = data.status === "PUBLISHED" ? new Date() : null;
  const product = await prisma.$transaction(async (tx) => {
    await requireActiveCategory(tx, data.categoryId);
    const created = await tx.product.create({
      data: {
        name: data.name, slug, sku: data.sku ?? null,
        shortDescription: data.shortDescription ?? null, description: data.description ?? null,
        regularPrice: data.regularPrice, salePrice: data.salePrice ?? null,
        categoryId: data.categoryId || null, status: data.status, isFeatured: data.isFeatured,
        videoUrl: data.videoUrl || null, weightGrams: data.weightGrams ?? null,
        ...(data.dimensions === undefined ? {} : { dimensions: data.dimensions === null ? Prisma.DbNull : data.dimensions }),
        attributes: data.attributes as never, specifications: data.specifications as never,
        publishedAt, createdById: actorId ?? null,
        images: { create: data.images.map((image, index) => ({ url: image.url, alt: image.alt ?? null, kind: image.kind, position: index })) },
        variants: {
          create: variants.map((variant, index) => ({
            name: variant.name, sku: variant.sku || null, price: variant.price ?? null,
            stock: variant.stock, lowStockThreshold: variant.lowStockThreshold,
            imageUrl: variant.imageUrl || null, attributes: variant.attributes as never,
            isActive: variant.isActive, position: variant.position || index,
          })),
        },
      },
      include: { variants: true, images: true },
    });
    // Stock exists even while a product is a draft. Record its opening balance
    // in the creation transaction rather than trying to infer it on publication.
    await tx.stockMovement.createMany({
      data: created.variants.filter((v) => v.stock > 0).map((v) => ({
        productId: created.id, variantId: v.id, type: "PURCHASE" as const,
        quantity: v.stock, balanceAfter: v.stock, reason: "Initial stock", createdById: actorId ?? null,
      })),
    });
    return created;
  });
  await audit({ actorId, action: "CREATE_PRODUCT", entity: "Product", entityId: product.id, after: { id: product.id, name: product.name, slug } });
  return product;
}

export async function updateProduct(id: string, input: ProductInput, actorId?: string) {
  const data = productSchema.parse(input);
  if (data.expectedStatus === undefined) {
    throw new ConflictError("Product status edit information is missing. Reload the product and try again");
  }
  if (data.categoryId !== undefined && data.expectedCategoryId === undefined) {
    throw new ConflictError("Category edit information is missing. Reload the product and try again");
  }
  const existing = await prisma.product.findUnique({ where: { id }, include: { variants: true } });
  if (!existing) throw new NotFoundError("Product not found");
  // Validate both the stored value and the original edit snapshot before any write.
  for (const variant of existing.variants) {
    normalizeStoredVariantAttributes(variant.attributes, { productName: existing.name, variantName: variant.name });
  }
  const submittedIds = new Set<string>();
  for (const variant of data.variants) {
    if (variant.id) {
      if (submittedIds.has(variant.id)) throw new ConflictError("A variant was submitted more than once");
      submittedIds.add(variant.id);
      if (variant.expectedStock === undefined || variant.expectedMovementCount === undefined
        || !variant.expectedUpdatedAt || variant.expectedAttributes === undefined) {
        throw new ConflictError("Variant edit information is missing. Reload the product and try again");
      }
      normalizeStoredVariantAttributes(variant.expectedAttributes, { productName: existing.name, variantName: variant.name });
    } else {
      if (variant.expectedStock !== undefined || variant.expectedMovementCount !== undefined
        || variant.expectedUpdatedAt !== undefined || variant.expectedAttributes !== undefined) {
        throw new ConflictError("A new variant cannot include an existing variant's edit information");
      }
      if (variant.attributes === undefined) throw new ConflictError(`New variant "${variant.name}" must include an attribute array`);
    }
  }
  const slug = await ensureUniqueSlug(data.slug ? slugify(data.slug) : existing.slug, id);

  const product = await prisma.$transaction(async (tx) => {
    const current = await tx.product.findUnique({ where: { id }, include: { variants: true } });
    if (!current) throw new NotFoundError("Product not found");
    for (const variant of current.variants) {
      normalizeStoredVariantAttributes(variant.attributes, { productName: current.name, variantName: variant.name });
    }
    const currentIds = new Set(current.variants.map((variant) => variant.id));
    if ([...submittedIds].some((variantId) => !currentIds.has(variantId))) {
      throw new ConflictError("A submitted variant does not belong to this product");
    }
    // Never delete persisted variants through a product save: their order,
    // movement and reservation references must remain intact.
    if (current.variants.some((variant) => !submittedIds.has(variant.id))) {
      throw new ConflictError("Existing variants cannot be removed here. Reload or deactivate the variant instead");
    }
    if (data.categoryId !== undefined && data.categoryId !== current.categoryId) {
      await requireActiveCategory(tx, data.categoryId);
    }

    const result = await tx.product.updateMany({
      // PostgreSQL rechecks this predicate after waiting on a concurrent row
      // update, so an old editor cannot silently republish an archived item.
      where: { id, status: data.expectedStatus, ...(data.categoryId === undefined ? {} : { categoryId: data.expectedCategoryId }) },
      data: {
        name: data.name, slug, sku: data.sku ?? null,
        shortDescription: data.shortDescription ?? null, description: data.description ?? null,
        regularPrice: data.regularPrice, salePrice: data.salePrice ?? null,
        ...(data.categoryId === undefined ? {} : { categoryId: data.categoryId }),
        status: data.status, isFeatured: data.isFeatured,
        videoUrl: data.videoUrl || null, weightGrams: data.weightGrams ?? null,
        ...(data.dimensions === undefined ? {} : { dimensions: data.dimensions === null ? Prisma.DbNull : data.dimensions }),
        attributes: data.attributes as never, specifications: data.specifications as never,
        publishedAt: data.status === "PUBLISHED" ? (current.publishedAt ?? new Date()) : null,
        archivedAt: data.status === "ARCHIVED" ? new Date() : null,
      },
    });
    if (result.count !== 1) {
      const latest = await tx.product.findUnique({ where: { id }, select: { status: true } });
      if (latest?.status !== data.expectedStatus) throw new ConflictError("Product status changed. Reload the product and try again");
      throw new ConflictError("Product category changed. Reload the product and try again");
    }
    const updated = await tx.product.findUniqueOrThrow({ where: { id } });
    // Lock all persisted variants in the same stable order used by order
    // restocking. This also makes the subsequent movement counts meaningful.
    for (const variantId of [...submittedIds].sort(compareStableIds)) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "ProductVariant" WHERE "id" = ${variantId} AND "productId" = ${id} FOR UPDATE
      `;
      if (!locked.length) throw new ConflictError("A product variant changed. Reload the product and try again");
    }
    await tx.productImage.deleteMany({ where: { productId: id } });
    await tx.productImage.createMany({
      data: data.images.map((image, index) => ({ productId: id, url: image.url, alt: image.alt ?? null, kind: image.kind, position: index })),
    });
    for (const [index, variant] of data.variants.entries()) {
      const values = {
        name: variant.name, sku: variant.sku || null, price: variant.price ?? null,
        stock: variant.stock, lowStockThreshold: variant.lowStockThreshold,
        imageUrl: variant.imageUrl || null,
        ...(variant.attributes === undefined ? {} : { attributes: variant.attributes as Prisma.InputJsonValue }),
        isActive: variant.isActive, position: variant.position || index,
      };
      if (variant.id) {
        if (variant.expectedStock === undefined || variant.expectedMovementCount === undefined
          || !variant.expectedUpdatedAt || variant.expectedAttributes === undefined) {
          throw new ConflictError("Variant edit information is missing. Reload the product and try again");
        }
        const movementCount = await tx.stockMovement.count({ where: { variantId: variant.id } });
        if (movementCount !== variant.expectedMovementCount) {
          throw new ConflictError(`Variant "${variant.name}" changed. Reload the product and try again`);
        }
        // Compare stock, ledger count and raw JSON as well as the timestamp.
        // The count detects cooperating stock operations even on timestamp ABA.
        const result = await tx.productVariant.updateMany({
          where: {
            id: variant.id, productId: id, stock: variant.expectedStock,
            updatedAt: new Date(variant.expectedUpdatedAt),
            attributes: { equals: variant.expectedAttributes as Prisma.InputJsonValue },
          },
          data: values,
        });
        if (result.count !== 1) throw new ConflictError(`Variant "${variant.name}" changed. Reload the product and try again`);
        if (variant.expectedStock !== variant.stock) {
          await tx.stockMovement.create({
            data: {
              productId: id, variantId: variant.id, type: "ADJUSTMENT",
              quantity: variant.stock - variant.expectedStock, balanceAfter: variant.stock,
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
      attributes: normalizeStoredVariantAttributes(variant.attributes, { productName: source.name, variantName: variant.name }), isActive: variant.isActive, position: index,
    })),
  }, actorId);
}

export async function setProductStatus(id: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED", actorId?: string) {
  if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) throw new ConflictError("Invalid product status");
  const product = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows.length) throw new NotFoundError("Product not found");
    const existing = await tx.product.findUniqueOrThrow({ where: { id } });
    // Publication is not an inventory event. In particular, do not manufacture
    // a historical opening movement for a legacy product from today's balance.
    return tx.product.update({
      where: { id },
      data: { status, publishedAt: status === "PUBLISHED" ? (existing.publishedAt ?? new Date()) : null, archivedAt: status === "ARCHIVED" ? new Date() : null },
    });
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
