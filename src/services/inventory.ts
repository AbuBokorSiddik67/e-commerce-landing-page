import type { Prisma, StockMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { exactVariantQuantities } from "@/lib/inventory-invariants";

type Tx = Prisma.TransactionClient;

/** Fail closed for legacy/imported orders without a complete, consistent recorded sale. */
export async function hasRecordedOrderSale(
  tx: Tx, orderId: string, productId: string, items: Array<{ variantId: string | null; quantity: number }>,
) {
  const movements = await tx.stockMovement.findMany({
    where: { reference: orderId, type: "SALE" },
    select: { productId: true, variantId: true, quantity: true, bucket: true, variant: { select: { productId: true } } },
  });
  return movements.every((movement) => movement.bucket === "SELLABLE" && movement.productId === productId && movement.variant?.productId === productId)
    && exactVariantQuantities(items, movements.map((movement) => ({ ...movement, quantity: -movement.quantity })));
}

/** Any other stock activity tied to an order is ambiguous outside the return workflow. */
export async function hasOtherOrderStockMovement(tx: Tx, orderId: string) {
  return Boolean(await tx.stockMovement.findFirst({
    where: { reference: orderId, type: { not: "SALE" } }, select: { id: true },
  }));
}

export async function adjustStock(
  tx: Tx,
  input: {
    variantId: string;
    delta: number;
    type: StockMovementType;
    reason?: string;
    reference?: string;
    actorId?: string | null;
    returnReceiptId?: string;
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
      ...(input.returnReceiptId ? { returnReceiptId: input.returnReceiptId } : {}),
    },
  });
  return balanceAfter;
}

/** Damaged units are a separate, non-sellable balance with their own ledger. */
export async function receiveDamagedStock(
  tx: Tx,
  input: { variantId: string; quantity: number; reference: string; returnReceiptId: string; actorId: string },
) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 2_147_483_647) {
    throw new ConflictError("Damaged quantity must be a positive integer");
  }
  const variant = await tx.productVariant.findUnique({ where: { id: input.variantId } });
  if (!variant) throw new NotFoundError("Product variant not found");
  const updated = await tx.productVariant.updateMany({
    where: { id: input.variantId, damagedStock: { lte: 2_147_483_647 - input.quantity } },
    data: { damagedStock: { increment: input.quantity } },
  });
  if (updated.count !== 1) throw new ConflictError("Damaged stock balance is too large");
  const balanceAfter = (await tx.productVariant.findUniqueOrThrow({
    where: { id: input.variantId }, select: { damagedStock: true },
  })).damagedStock;
  await tx.stockMovement.create({ data: {
    productId: variant.productId, variantId: input.variantId, type: "RETURN", bucket: "DAMAGED",
    quantity: input.quantity, balanceAfter, reason: `Inspected damaged return ${input.returnReceiptId}`,
    reference: input.reference, returnReceiptId: input.returnReceiptId, createdById: input.actorId,
  } });
  return balanceAfter;
}

export async function setStock(
  variantId: string, stock: number, expectedStock: number, expectedMovementCount: number, reason: string, actorId?: string,
) {
  if (![stock, expectedStock].every((value) => Number.isInteger(value) && value >= 0 && value <= 2_147_483_647)) {
    throw new ConflictError("Stock must be a non-negative integer");
  }
  if (!Number.isSafeInteger(expectedMovementCount) || expectedMovementCount < 0) {
    throw new ConflictError("A valid stock movement snapshot is required");
  }
  return prisma.$transaction(async (tx) => {
    // Every cooperating stock writer updates this row before recording its
    // movement. Lock it before comparing both the balance and ledger count;
    // balance alone cannot detect a sale and restoration that net to zero.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ProductVariant" WHERE "id" = ${variantId} FOR UPDATE
    `;
    if (!locked.length) throw new NotFoundError("Variant not found");
    const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundError("Variant not found");
    const movementCount = await tx.stockMovement.count({ where: { variantId } });
    if (variant.stock !== expectedStock || movementCount !== expectedMovementCount) {
      throw new ConflictError("Stock changed. Reload inventory and try again");
    }
    const result = await tx.productVariant.updateMany({ where: { id: variantId, stock: expectedStock }, data: { stock } });
    if (result.count !== 1) throw new ConflictError("Stock changed. Reload inventory and try again");
    if (stock !== expectedStock) {
      await tx.stockMovement.create({
        data: {
          productId: variant.productId, variantId, type: "ADJUSTMENT", quantity: stock - expectedStock,
          balanceAfter: stock, reason, createdById: actorId ?? null,
        },
      });
    }
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
