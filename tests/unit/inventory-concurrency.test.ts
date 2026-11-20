import { beforeEach, describe, expect, it, vi } from "vitest";

// A transactional in-memory mock: no database connection or record writes.
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), lockVariant: vi.fn(), findVariant: vi.fn(), updateMany: vi.fn(), countMovements: vi.fn(), createMovement: vi.fn(),
  requirePermission: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: (location: string) => { throw new Error(`TEST_REDIRECT:${location}`); } }));

import { setStock } from "@/services/inventory";
import { setStockAction } from "@/app/actions/products";

let stock: number;
const tx = {
  $queryRaw: mocks.lockVariant,
  productVariant: { findUnique: mocks.findVariant, updateMany: mocks.updateMany },
  stockMovement: { count: mocks.countMovements, create: mocks.createMovement },
};

beforeEach(() => {
  vi.resetAllMocks();
  stock = 7;
  mocks.requirePermission.mockResolvedValue({ id: "owner-1" });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  mocks.lockVariant.mockResolvedValue([{ id: "variant-1" }]);
  mocks.countMovements.mockResolvedValue(1);
  mocks.findVariant.mockImplementation(async () => ({ id: "variant-1", productId: "product-1", stock }));
  mocks.updateMany.mockImplementation(async ({ where, data }: { where: { id: string; stock: number }; data: { stock: number } }) => {
    if (where.id !== "variant-1" || where.stock !== stock) return { count: 0 };
    stock = data.stock;
    return { count: 1 };
  });
});

async function submit(form: FormData) {
  try {
    await setStockAction(form);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TEST_REDIRECT:")) {
      return new URL(error.message.slice("TEST_REDIRECT:".length), "http://test.invalid");
    }
    throw error;
  }
  throw new Error("Expected redirect");
}

describe("inventory stock compare-and-swap", () => {
  it("updates matching stock and records the exact adjustment", async () => {
    await expect(setStock("variant-1", 5, 7, 1, "Counted", "owner-1")).resolves.toBe(5);
    expect(stock).toBe(5);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "variant-1", stock: 7 }, data: { stock: 5 } });
    expect(mocks.createMovement).toHaveBeenCalledWith({ data: {
      productId: "product-1", variantId: "variant-1", type: "ADJUSTMENT", quantity: -2,
      balanceAfter: 5, reason: "Counted", createdById: "owner-1",
    } });
  });

  it("rejects a stale form without changing stock or creating a movement", async () => {
    stock = 6;
    await expect(setStock("variant-1", 5, 7, 1, "Counted")).rejects.toThrow(/Stock changed/);
    expect(stock).toBe(6);
    expect(mocks.createMovement).not.toHaveBeenCalled();
  });

  it("rejects a race between the read and conditional update", async () => {
    mocks.updateMany.mockImplementationOnce(async () => { stock = 6; return { count: 0 }; });
    await expect(setStock("variant-1", 5, 7, 1, "Counted")).rejects.toThrow(/Stock changed/);
    expect(stock).toBe(6);
    expect(mocks.createMovement).not.toHaveBeenCalled();
  });

  it("rejects an unchanged balance if the movement snapshot is stale", async () => {
    mocks.countMovements.mockResolvedValueOnce(3);
    await expect(setStock("variant-1", 5, 7, 1, "Stale count")).rejects.toThrow(/Stock changed/);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.createMovement).not.toHaveBeenCalled();
  });

  it("does not create an adjustment movement for an unchanged balance", async () => {
    await setStock("variant-1", 7, 7, 1, "No change");
    expect(mocks.createMovement).not.toHaveBeenCalled();
  });

  it.each([NaN, -1, 1.5, 2_147_483_648])("rejects invalid stock %s before a transaction", async (invalid) => {
    await expect(setStock("variant-1", invalid, 7, 1, "Counted")).rejects.toThrow(/non-negative integer/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires a stock snapshot in the inventory action instead of defaulting it to zero", async () => {
    const form = new FormData();
    form.set("variantId", "variant-1");
    form.set("stock", "5");
    const result = await submit(form);
    expect(result.searchParams.get("error")).toContain("expectedStock is required");
    expect(mocks.requirePermission).toHaveBeenCalledWith("inventory.write");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires a movement snapshot in the inventory action", async () => {
    const form = new FormData();
    form.set("variantId", "variant-1");
    form.set("stock", "5");
    form.set("expectedStock", "7");
    const result = await submit(form);
    expect(result.searchParams.get("error")).toContain("expectedMovementCount is required");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("submits the expected balance through the inventory action", async () => {
    const form = new FormData();
    form.set("variantId", "variant-1");
    form.set("stock", "5");
    form.set("expectedStock", "7");
    form.set("expectedMovementCount", "1");
    form.set("reason", "Counted");
    const result = await submit(form);
    expect(result.searchParams.get("success")).toBe("Stock adjusted");
    expect(stock).toBe(5);
  });
});
