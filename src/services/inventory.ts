import type { Prisma, StockMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

export async function adjustStock(
  tx: Tx,
  input: {
    variantId: string;
    delta: number;
    type: StockMovementType;
    reason?: string;
    reference?: string;
    actorId?: string | null;
  },
) {
  const variant = await tx.productVariant.findUnique({ where: { id: input.variantId } });
  if (!variant) throw new NotFoundError("Product variant not found");

  if (input.delta < 0) {
    // Atomic conditional update prevents overselling under concurrent checkouts.
    const updated = await tx.productVariant.updateMany({
      where: { id: input.variantId, stock: { gte: Math.abs(input.delta) } },
      data: { stock: { decrement: Math.abs(input.delta) } },
    });
    if (updated.count === 0) throw new ConflictError("Insufficient stock for this variant");
  } else {
    await tx.productVariant.update({ where: { id: input.variantId }, data: { stock: { increment: input.delta } } });
  }

  const balanceAfter = (await tx.productVariant.findUniqueOrThrow({ where: { id: input.variantId }, select: { stock: true } })).stock;
  await tx.stockMovement.create({
    data: {
      productId: variant.productId,
      variantId: input.variantId,
      type: input.type,
      quantity: input.delta,
      balanceAfter,
      reason: input.reason,
      reference: input.reference,
      createdById: input.actorId ?? null,
    },
  });
  return balanceAfter;
}

export async function setStock(variantId: string, stock: number, reason: string, actorId?: string) {
  if (!Number.isInteger(stock) || stock < 0) throw new ConflictError("Stock must be a non-negative integer");
  return prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundError("Variant not found");
    await tx.productVariant.update({ where: { id: variantId }, data: { stock } });
    await tx.stockMovement.create({
      data: {
        productId: variant.productId, variantId, type: "ADJUSTMENT", quantity: stock - variant.stock,
        balanceAfter: stock, reason, createdById: actorId ?? null,
      },
    });
    return stock;
  });
}

export async function lowStockVariants(threshold?: number) {
  return prisma.productVariant.findMany({
    where: { isActive: true, stock: { lte: threshold ?? 5 } },
    include: { product: { select: { id: true, name: true, slug: true, status: true } } },
    orderBy: { stock: "asc" },
  });
}
