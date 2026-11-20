import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { variantAttributesSchema } from "@/lib/product-attributes";
import { prisma, closeAll, resetDatabase } from "../helpers";

beforeEach(resetDatabase);
afterAll(closeAll);

describe("variant attribute migration", () => {
  it("preserves legacy values and relationships, leaves arrays intact, and changes the default", async () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261120050000_normalize_variant_attributes/migration.sql"), "utf8");
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { name: "Migration test", slug: "migration-test", regularPrice: 100 } });
      const legacy = await tx.productVariant.create({ data: { productId: product.id, name: "Legacy", attributes: { Size: "M", Color: "Black" } } });
      const empty = await tx.productVariant.create({ data: { productId: product.id, name: "Empty", attributes: {} } });
      const array = await tx.productVariant.create({ data: { productId: product.id, name: "Array", attributes: [{ name: "Size", value: "S" }] } });
      const badValue = await tx.productVariant.create({ data: { productId: product.id, name: "Bad value", attributes: { Size: 42 } } });
      const movement = await tx.stockMovement.create({ data: { productId: product.id, variantId: legacy.id, type: "PURCHASE", quantity: 1, balanceAfter: 1 } });

      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
        await tx.$executeRawUnsafe(statement);
      }

      expect((await tx.productVariant.findUniqueOrThrow({ where: { id: legacy.id } })).attributes).toEqual([
        { name: "Color", value: "Black" }, { name: "Size", value: "M" },
      ]);
      expect((await tx.productVariant.findUniqueOrThrow({ where: { id: empty.id } })).attributes).toEqual([]);
      expect((await tx.productVariant.findUniqueOrThrow({ where: { id: array.id } })).attributes).toEqual([{ name: "Size", value: "S" }]);
      const invalid = (await tx.productVariant.findUniqueOrThrow({ where: { id: badValue.id } })).attributes;
      expect(invalid).toEqual([{ name: "Size", value: 42 }]);
      expect(variantAttributesSchema.safeParse(invalid).success).toBe(false);
      expect((await tx.stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).variantId).toBe(legacy.id);
      expect((await tx.productVariant.create({ data: { productId: product.id, name: "Default" } })).attributes).toEqual([]);
    });
  });
});
