// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This suite uses only in-memory Prisma mocks; it never connects to a database.
const mocks = vi.hoisted(() => ({
  findProduct: vi.fn(), findCategories: vi.fn(), lockCategory: vi.fn(), lockVariant: vi.fn(), transaction: vi.fn(), productUpdate: vi.fn(), productCreate: vi.fn(),
  imageDeleteMany: vi.fn(), imageCreateMany: vi.fn(), variantDeleteMany: vi.fn(),
  variantUpdateMany: vi.fn(), variantCreate: vi.fn(), movementCount: vi.fn(), movementCreate: vi.fn(), movementCreateMany: vi.fn(),
  orderUpdate: vi.fn(), orderItemUpdate: vi.fn(), orderItemUpdateMany: vi.fn(), orderItemDeleteMany: vi.fn(),
  landingPageCreate: vi.fn(), audit: vi.fn(), requirePermission: vi.fn(), revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: mocks.findProduct },
    category: { findMany: mocks.findCategories },
    landingPage: { create: mocks.landingPageCreate },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission, requirePageAccess: vi.fn().mockResolvedValue({ id: "fixture-viewer" }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => { throw new Error(`TEST_REDIRECT:${location}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import { duplicateProductAction, saveProductAction } from "@/app/actions/products";
import EditProduct from "@/app/dashboard/products/[id]/page";
import { StoredVariantAttributesError } from "@/lib/product-attributes";
import { duplicateProduct } from "@/services/products";

type VariantWrite = {
  name: string; sku: string | null; price: number | null; stock: number; lowStockThreshold: number;
  imageUrl: string | null; attributes: unknown; isActive: boolean; position: number;
};
type SourceProduct = {
  id: string; name: string; slug: string; sku: string | null; shortDescription: string | null;
  description: string | null; regularPrice: number; salePrice: number | null; categoryId: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; isFeatured: boolean; videoUrl: string | null; weightGrams: number | null;
  dimensions: { length?: number; width?: number; height?: number } | null; attributes: string[];
  category?: { id: string; name: string; isActive: boolean } | null;
  specifications: Array<{ name: string; value: string }>; publishedAt: Date | null;
  images: Array<{ url: string; alt: string | null; kind: "IMAGE" | "VIDEO" }>;
  variants: Array<VariantWrite & { id: string; productId: string; updatedAt: Date; _count: { movements: number } }>;
};

function sourceProduct(): SourceProduct {
  return {
    id: "product-1", name: "Cotton shirt", slug: "cotton-shirt", sku: null,
    shortDescription: null, description: null, regularPrice: 500, salePrice: null,
    categoryId: null, status: "DRAFT", isFeatured: false, videoUrl: null, weightGrams: null,
    dimensions: null, attributes: ["Size", "Color"], specifications: [], publishedAt: null,
    images: [],
    variants: [
      { id: "variant-1", productId: "product-1", name: "Medium", sku: "M", price: null, stock: 7,
        lowStockThreshold: 2, imageUrl: null, attributes: { Size: "M, tall", Color: "Black" } as unknown, isActive: true, position: 0,
        updatedAt: new Date("2025-01-01T00:00:00.000Z"), _count: { movements: 0 } },
      { id: "variant-2", productId: "product-1", name: "Small", sku: "S", price: null, stock: 3,
        lowStockThreshold: 2, imageUrl: null, attributes: [{ name: "Size", value: "S" }] as unknown, isActive: true, position: 1,
        updatedAt: new Date("2025-01-01T00:00:01.000Z"), _count: { movements: 0 } },
    ],
  };
}

type CreateData = { name: string; slug: string; status: string; variants: { create: VariantWrite[] } };

let product: ReturnType<typeof sourceProduct>;
let orderSnapshot: { id: string; productId: string; item: { variantId: string; attributes: { Size: string; Color: string } } };
let copies: Array<{ id: string; name: string; slug: string; status: string; variants: Array<VariantWrite & { id: string; productId: string }> }>;

const tx = {
  product: { findUnique: mocks.findProduct, findUniqueOrThrow: mocks.findProduct, updateMany: mocks.productUpdate, create: mocks.productCreate },
  $queryRaw: (sql: TemplateStringsArray, ...values: string[]) => sql.join("?").includes('"ProductVariant"')
    ? mocks.lockVariant(sql, ...values) : mocks.lockCategory(sql, ...values),
  productImage: { deleteMany: mocks.imageDeleteMany, createMany: mocks.imageCreateMany },
  productVariant: { deleteMany: mocks.variantDeleteMany, updateMany: mocks.variantUpdateMany, create: mocks.variantCreate },
  stockMovement: { count: mocks.movementCount, create: mocks.movementCreate, createMany: mocks.movementCreateMany },
  order: { update: mocks.orderUpdate },
  orderItem: { update: mocks.orderItemUpdate, updateMany: mocks.orderItemUpdateMany, deleteMany: mocks.orderItemDeleteMany },
};

beforeEach(() => {
  vi.resetAllMocks();
  product = sourceProduct();
  orderSnapshot = { id: "order-1", productId: product.id, item: { variantId: "variant-1", attributes: { Size: "M, tall", Color: "Black" } } };
  copies = [];
  mocks.requirePermission.mockResolvedValue({ id: "owner-1" });
  mocks.findCategories.mockResolvedValue([{ id: "active-category", name: "Active", isActive: true }]);
  mocks.lockCategory.mockImplementation(async (_sql: TemplateStringsArray, categoryId: string) => {
    if (categoryId === "active-category") return [{ isActive: true }];
    if (categoryId === "inactive-category") return [{ isActive: false }];
    return [];
  });
  mocks.lockVariant.mockImplementation(async (_sql: TemplateStringsArray, variantId: string, productId: string) =>
    product.variants.some((variant) => variant.id === variantId && variant.productId === productId) ? [{ id: variantId }] : []);
  mocks.movementCount.mockImplementation(async ({ where }: { where: { variantId: string } }) =>
    product.variants.find((variant) => variant.id === where.variantId)?._count.movements ?? 0);
  mocks.movementCreate.mockImplementation(async ({ data }: { data: { variantId: string } }) => {
    const variant = product.variants.find((value) => value.id === data.variantId);
    if (variant) variant._count.movements++;
  });
  mocks.audit.mockResolvedValue(undefined);
  mocks.findProduct.mockImplementation(async ({ where }: { where: { id?: string; slug?: string } }) => {
    if (where.id === product.id || where.slug === product.slug) return structuredClone(product);
    return null;
  });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const beforeProduct = structuredClone(product);
    const beforeCopies = structuredClone(copies);
    try {
      return await callback(tx);
    } catch (error) {
      // Model transaction rollback; this is not a substitute for a real database test.
      product = beforeProduct;
      copies = beforeCopies;
      throw error;
    }
  });
  mocks.productUpdate.mockImplementation(async ({ where, data }: { where: { id: string; status?: string; categoryId?: string | null }; data: Record<string, unknown> }) => {
    if (where.id !== product.id || (where.status !== undefined && where.status !== product.status)
      || (where.categoryId !== undefined && where.categoryId !== product.categoryId)) return { count: 0 };
    const applied = { ...data };
    if (applied.dimensions === Prisma.DbNull) applied.dimensions = null;
    product = { ...product, ...applied };
    return { count: 1 };
  });
  mocks.variantDeleteMany.mockImplementation(async ({ where }: { where: { productId: string; id: { notIn: string[] } } }) => {
    product.variants = product.variants.filter((variant) => variant.productId !== where.productId || where.id.notIn.includes(variant.id));
    return { count: 0 };
  });
  mocks.variantUpdateMany.mockImplementation(async ({ where, data }: {
    where: { id: string; productId: string; stock: number; updatedAt: Date; attributes: { equals: unknown } };
    data: Partial<VariantWrite>;
  }) => {
    const index = product.variants.findIndex((variant) => variant.id === where.id && variant.productId === where.productId);
    const current = product.variants[index];
    if (!current || current.stock !== where.stock || current.updatedAt.getTime() !== where.updatedAt.getTime()
      || !isDeepStrictEqual(current.attributes, where.attributes.equals)) return { count: 0 };
    product.variants[index] = { ...current, ...data, updatedAt: new Date(current.updatedAt.getTime() + 1) };
    return { count: 1 };
  });
  mocks.variantCreate.mockImplementation(async ({ data }: { data: VariantWrite & { productId: string } }) => {
    const created = { ...data, id: "variant-new", updatedAt: new Date("2025-01-02T00:00:00.000Z"), _count: { movements: 0 } };
    product.variants.push(created);
    return structuredClone(created);
  });
  mocks.productCreate.mockImplementation(async ({ data }: { data: CreateData }) => {
    const copy = {
      id: "copy-1", name: data.name, slug: data.slug, status: data.status,
      variants: data.variants.create.map((variant, index) => ({ ...variant, id: `copy-variant-${index + 1}`, productId: "copy-1" })),
    };
    copies.push(copy);
    return copy;
  });
  mocks.imageDeleteMany.mockResolvedValue({ count: 0 });
  mocks.imageCreateMany.mockResolvedValue({ count: 0 });
  mocks.landingPageCreate.mockResolvedValue({ id: "page-1" });
});
afterEach(cleanup);

function productForm(firstAttributes: unknown, existing = true) {
  const form = new FormData();
  if (existing) {
    form.set("id", product.id);
    form.set("expectedStatus", product.status);
  }
  form.set("name", existing ? "Updated cotton shirt" : "New cotton shirt");
  form.set("slug", existing ? product.slug : "new-cotton-shirt");
  form.set("regularPrice", "500");
  form.set("status", "DRAFT");
  form.set("attributes", JSON.stringify(product.attributes));
  form.set("variants", JSON.stringify(product.variants.map((variant, index) => ({
    ...(existing ? { id: variant.id, expectedStock: variant.stock, expectedMovementCount: variant._count.movements,
      expectedUpdatedAt: variant.updatedAt.toISOString(), expectedAttributes: variant.attributes } : {}),
    name: variant.name, sku: existing ? variant.sku : null,
    price: variant.price, stock: variant.stock, lowStockThreshold: variant.lowStockThreshold,
    imageUrl: variant.imageUrl, attributes: index === 0 ? firstAttributes : variant.attributes,
    isActive: variant.isActive, position: index,
  }))));
  return form;
}

async function submit(action: (form: FormData) => Promise<void>, form: FormData) {
  try {
    await action(form);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TEST_REDIRECT:")) {
      return new URL(error.message.slice("TEST_REDIRECT:".length), "http://test.invalid");
    }
    throw error;
  }
  throw new Error("Expected a redirect");
}

function expectNoOrderWrites() {
  expect(mocks.orderUpdate).not.toHaveBeenCalled();
  expect(mocks.orderItemUpdate).not.toHaveBeenCalled();
  expect(mocks.orderItemUpdateMany).not.toHaveBeenCalled();
  expect(mocks.orderItemDeleteMany).not.toHaveBeenCalled();
}

describe("variant attribute product flows with mocked Prisma", () => {
  it("loads a legacy product and saves the rendered form without changing IDs, stock, relationships or order snapshots", async () => {
    const beforeProduct = structuredClone(product);
    const beforeOrder = structuredClone(orderSnapshot);
    const attributes = [{ name: "Size", value: "M, tall" }, { name: "Color", value: "Black" }];
    const { container } = render(await EditProduct({ params: Promise.resolve({ id: product.id }) }));
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: "Updated cotton shirt" } });
    const form = container.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("Expected product form");
    const result = await submit(saveProductAction, new FormData(form));

    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(product.id).toBe(beforeProduct.id);
    expect(product.variants.map((variant) => ({ id: variant.id, productId: variant.productId, stock: variant.stock }))).toEqual(
      beforeProduct.variants.map((variant) => ({ id: variant.id, productId: variant.productId, stock: variant.stock })),
    );
    expect(product.variants[0].attributes).toEqual(attributes);
    expect(product.variants[1].attributes).toEqual(beforeProduct.variants[1].attributes);
    expect(mocks.variantDeleteMany).not.toHaveBeenCalled();
    expect(mocks.variantUpdateMany).toHaveBeenCalledWith({
      where: { id: "variant-1", productId: "product-1", stock: 7, updatedAt: beforeProduct.variants[0].updatedAt,
        attributes: { equals: beforeProduct.variants[0].attributes } },
      data: expect.objectContaining({ attributes, stock: 7 }),
    });
    expect(mocks.variantCreate).not.toHaveBeenCalled();
    expect(mocks.movementCreate).not.toHaveBeenCalled();
    expect(orderSnapshot).toEqual(beforeOrder);
    expectNoOrderWrites();
  });

  it("round-trips structured punctuation and whitespace from the rendered editor through the mocked action and service", async () => {
    product.variants[0].attributes = { "  Size,:\t": " M, tall: regular  ", "Line\r\nname": "first\r\nsecond" };
    const { container, unmount } = render(await EditProduct({ params: Promise.resolve({ id: product.id }) }));
    const group = within(screen.getByRole("group", { name: "Attributes for Medium" }));
    fireEvent.change(group.getAllByLabelText("Attribute value")[0], { target: { value: " XL,: wide \t" } });
    fireEvent.change(group.getAllByLabelText("Attribute value")[1], { target: { value: "first\nsecond!" } });
    fireEvent.click(group.getByRole("button", { name: "Add attribute to Medium" }));
    fireEvent.change(group.getAllByLabelText(/^Attribute name/)[2], { target: { value: " Color, : " } });
    fireEvent.change(group.getAllByLabelText("Attribute value")[2], { target: { value: " Navy: blue, \t" } });
    const form = container.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("Expected product form");
    expect((await submit(saveProductAction, new FormData(form))).searchParams.get("success")).toBe("Product updated");
    const expected = [
      { name: "  Size,:\t", value: " XL,: wide \t" },
      { name: "Line\r\nname", value: "first\r\nsecond!" },
      { name: " Color, : ", value: " Navy: blue, \t" },
    ];
    expect(product.variants[0].attributes).toEqual(expected);
    unmount();
    render(await EditProduct({ params: Promise.resolve({ id: product.id }) }));
    const reopened = within(screen.getByRole("group", { name: "Attributes for Medium" }));
    expect(reopened.getAllByLabelText(/^Attribute name/).map((element) => (element as HTMLTextAreaElement).value)).toEqual(["  Size,:\t", "Line\nname", " Color, : "]);
    expect(reopened.getAllByLabelText("Attribute value").map((element) => (element as HTMLTextAreaElement).value)).toEqual([" XL,: wide \t", "first\nsecond!", " Navy: blue, \t"]);
  });

  it("creates variants with canonical arrays through the product action", async () => {
    const attributes = [{ name: "Size", value: "M" }, { name: "Color", value: "Black" }];
    const result = await submit(saveProductAction, productForm(attributes, false));
    expect(result.searchParams.get("success")).toBe("Product created");
    expect(copies[0].variants[0].attributes).toEqual(attributes);
    expect(copies[0].variants[1].attributes).toEqual([{ name: "Size", value: "S" }]);
    expect(mocks.landingPageCreate).toHaveBeenCalledOnce();
    expectNoOrderWrites();
  });

  it("leaves omitted existing attributes untouched, including the legacy JSON shape", async () => {
    const before = structuredClone(product.variants[0].attributes);
    const result = await submit(saveProductAction, productForm(undefined));
    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(product.variants[0].attributes).toEqual(before);
    expect(mocks.variantUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "variant-1", productId: "product-1" }),
      data: expect.not.objectContaining({ attributes: expect.anything() }),
    });
  });

  it("treats an explicit empty attribute array as a deliberate clear", async () => {
    const result = await submit(saveProductAction, productForm([]));
    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(product.variants[0].attributes).toEqual([]);
  });

  it("requires explicit canonical attributes for a new variant", async () => {
    const result = await submit(saveProductAction, productForm(undefined, false));
    expect(result.searchParams.get("error")).toMatch(/must include an attribute array/);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(copies).toEqual([]);
  });

  it("rejects a new variant without attributes on update", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    const raw = form.get("variants");
    if (typeof raw !== "string") throw new Error("Missing variants");
    const variants: unknown[] = JSON.parse(raw);
    variants.push({ name: "New", stock: 0 });
    form.set("variants", JSON.stringify(variants));
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/must include an attribute array/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown stored entry fields", [{ name: "Size", value: "M", source: "do not discard" }]],
    ["ambiguous partial stored object", { name: "Size" }],
  ])("rejects a direct update over %s", async (_label, stored) => {
    product.variants[0].attributes = stored;
    const before = structuredClone(product);
    const result = await submit(saveProductAction, productForm([]));
    expect(result.searchParams.get("error")).toContain("Cannot safely load attributes");
    expect(product).toEqual(before);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNoOrderWrites();
  });

  it("rejects unknown variant fields rather than silently ignoring misspelled attributes", async () => {
    const form = productForm(undefined);
    const raw = form.get("variants");
    if (typeof raw !== "string") throw new Error("Missing variants");
    const variants: Array<Record<string, unknown>> = JSON.parse(raw);
    variants[0].attribtues = [{ name: "Size", value: "M" }];
    form.set("variants", JSON.stringify(variants));
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toBeTruthy();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["object-shaped attributes", { Size: "M" }],
    ["unknown entry fields", [{ name: "Size", value: "M", extra: "do not discard" }]],
  ])("rejects new %s before any Prisma write", async (_label, attributes) => {
    const result = await submit(saveProductAction, productForm(attributes));
    expect(result.searchParams.get("error")).toBeTruthy();
    expect(mocks.findProduct).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNoOrderWrites();
  });

  it("rejects foreign and duplicate variant IDs before changing the product", async () => {
    for (const kind of ["foreign", "duplicate"] as const) {
      vi.clearAllMocks();
      const form = productForm([{ name: "Size", value: "M" }]);
      const raw = form.get("variants");
      if (typeof raw !== "string") throw new Error("Missing variants");
      const variants: Array<Record<string, unknown>> = JSON.parse(raw);
      if (kind === "foreign") variants[0].id = "other-products-variant";
      else variants[1].id = variants[0].id;
      form.set("variants", JSON.stringify(variants));
      const before = structuredClone(product);
      const result = await submit(saveProductAction, form);
      expect(result.searchParams.get("error")).toMatch(kind === "foreign" ? /does not belong/ : /more than once/);
      expect(product).toEqual(before);
      expect(mocks.productUpdate).not.toHaveBeenCalled();
      expect(mocks.variantUpdateMany).not.toHaveBeenCalled();
      expect(mocks.variantDeleteMany).not.toHaveBeenCalled();
    }
  });

  it("rejects omission of persisted variants rather than deleting their relationships", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    const raw = form.get("variants");
    if (typeof raw !== "string") throw new Error("Missing variants");
    const variants: unknown[] = JSON.parse(raw);
    variants.pop();
    form.set("variants", JSON.stringify(variants));
    const before = structuredClone(product);
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/cannot be removed/);
    expect(product).toEqual(before);
    expect(mocks.productUpdate).not.toHaveBeenCalled();
    expect(mocks.variantDeleteMany).not.toHaveBeenCalled();
    expectNoOrderWrites();
  });

  it("requires the edit preconditions for existing variants", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    const raw = form.get("variants");
    if (typeof raw !== "string") throw new Error("Missing variants");
    const variants: Array<Record<string, unknown>> = JSON.parse(raw);
    delete variants[0].expectedStock;
    form.set("variants", JSON.stringify(variants));
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/edit information is missing/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects stale stock without overwriting it or making a movement", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    product.variants[0].stock = 6; // A checkout happened after the form was loaded.
    const before = structuredClone(product);
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/changed.*Reload/);
    expect(product).toEqual(before);
    expect(mocks.movementCreate).not.toHaveBeenCalled();
    expect(mocks.variantDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects stale attributes even when the timestamp and stock did not change", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    product.variants[0].attributes = [{ name: "Size", value: "Changed elsewhere" }];
    const before = structuredClone(product);
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/changed.*Reload/);
    expect(product).toEqual(before);
    expect(mocks.movementCreate).not.toHaveBeenCalled();
  });

  it("rolls back the product update when the conditional variant update loses a race", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    const before = structuredClone(product);
    mocks.variantUpdateMany.mockResolvedValueOnce({ count: 0 });
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/changed.*Reload/);
    expect(product).toEqual(before);
    expect(mocks.movementCreate).not.toHaveBeenCalled();
  });

  it("records an authorized stock change against the matched original balance", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    const raw = form.get("variants");
    if (typeof raw !== "string") throw new Error("Missing variants");
    const variants: Array<Record<string, unknown>> = JSON.parse(raw);
    variants[0].stock = 5;
    form.set("variants", JSON.stringify(variants));
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(mocks.requirePermission).toHaveBeenCalledWith("inventory.write");
    expect(product.variants[0].stock).toBe(5);
    expect(mocks.movementCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      productId: "product-1", variantId: "variant-1", type: "ADJUSTMENT", quantity: -2, balanceAfter: 5,
    }) });
  });

  it("rejects a stock change without inventory permission", async () => {
    mocks.requirePermission.mockImplementation(async (permission: string) => {
      if (permission === "inventory.write") throw new Error("Inventory permission required");
      return { id: "owner-1" };
    });
    const form = productForm([{ name: "Size", value: "M" }]);
    const raw = form.get("variants");
    if (typeof raw !== "string") throw new Error("Missing variants");
    const variants: Array<Record<string, unknown>> = JSON.parse(raw);
    variants[0].stock = 9;
    form.set("variants", JSON.stringify(variants));
    const before = structuredClone(product);
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/Inventory permission required/);
    expect(product).toEqual(before);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("adds a new variant without deleting any existing variant", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    const raw = form.get("variants");
    if (typeof raw !== "string") throw new Error("Missing variants");
    const variants: unknown[] = JSON.parse(raw);
    variants.push({ name: "New", stock: 0, attributes: [] });
    form.set("variants", JSON.stringify(variants));
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(product.variants.map((variant) => variant.id)).toEqual(["variant-1", "variant-2", "variant-new"]);
    expect(mocks.variantDeleteMany).not.toHaveBeenCalled();
    expectNoOrderWrites();
  });

  it("preserves an inactive category and dimensions through a rendered unrelated edit", async () => {
    product.categoryId = "inactive-category";
    product.category = { id: "inactive-category", name: "Hidden category", isActive: false };
    product.dimensions = { length: 10, width: 2.5, height: 3 };
    const { container } = render(await EditProduct({ params: Promise.resolve({ id: product.id }) }));
    const category = screen.getByLabelText("Category") as HTMLSelectElement;
    expect(category.value).toBe("inactive-category");
    expect(screen.getByRole("option", { name: /Hidden category.*inactive/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: "Updated shirt" } });
    const form = container.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("Expected product form");
    const submitted = new FormData(form);
    expect(submitted.get("categoryId")).toBe("inactive-category");
    expect(submitted.get("expectedCategoryId")).toBe("inactive-category");
    expect(submitted.get("expectedStatus")).toBe(product.status);
    expect(submitted.has("dimensions")).toBe(false);
    const result = await submit(saveProductAction, submitted);
    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(product.categoryId).toBe("inactive-category");
    expect(product.dimensions).toEqual({ length: 10, width: 2.5, height: 3 });
    expect(mocks.lockCategory).not.toHaveBeenCalled();
    expect(mocks.productUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "product-1", categoryId: "inactive-category", status: "DRAFT" },
      data: expect.not.objectContaining({ dimensions: expect.anything() }),
    }));
  });

  it("preserves omitted category and dimensions in direct submissions", async () => {
    product.categoryId = "inactive-category";
    product.dimensions = { length: 8, height: 5 };
    const result = await submit(saveProductAction, productForm([{ name: "Size", value: "M" }]));
    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(product.categoryId).toBe("inactive-category");
    expect(product.dimensions).toEqual({ length: 8, height: 5 });
  });

  it("allows an existing inactive category to be changed to an active one", async () => {
    product.categoryId = "inactive-category";
    const form = productForm([{ name: "Size", value: "M" }]);
    form.set("categoryId", "active-category");
    form.set("expectedCategoryId", "inactive-category");
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(product.categoryId).toBe("active-category");
    expect(mocks.lockCategory).toHaveBeenCalledWith(expect.any(Array), "active-category");
    expect((mocks.lockCategory.mock.calls[0][0] as TemplateStringsArray).join("?")).toMatch(/FROM "Category".*WHERE "id" = \? FOR SHARE/s);
  });

  it.each(["inactive-category", "missing-category"])("rejects assigning category %s on update", async (categoryId) => {
    const form = productForm([{ name: "Size", value: "M" }]);
    form.set("categoryId", categoryId);
    form.set("expectedCategoryId", "");
    const before = structuredClone(product);
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/active category/);
    expect(product).toEqual(before);
    expect(mocks.productUpdate).not.toHaveBeenCalled();
  });

  it("rejects an inactive category on product creation", async () => {
    const form = productForm([{ name: "Size", value: "M" }], false);
    form.set("categoryId", "inactive-category");
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/active category/);
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("allows an explicit removal of the current category", async () => {
    product.categoryId = "inactive-category";
    const form = productForm([{ name: "Size", value: "M" }]);
    form.set("categoryId", "");
    form.set("expectedCategoryId", "inactive-category");
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("success")).toBe("Product updated");
    expect(product.categoryId).toBeNull();
  });

  it("does not silently copy an inactive category onto a new product", async () => {
    product.categoryId = "inactive-category";
    await expect(duplicateProduct(product.id, "owner-1")).rejects.toThrow(/active category/);
    expect(mocks.productCreate).not.toHaveBeenCalled();
    expect(product.categoryId).toBe("inactive-category");
  });

  it("rejects a stale category selection instead of overwriting the current relationship", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    form.set("categoryId", "");
    form.set("expectedCategoryId", "");
    product.categoryId = "active-category";
    const before = structuredClone(product);
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/category changed.*Reload/);
    expect(product).toEqual(before);
  });

  it("requires a publication-status snapshot for product edits", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    form.delete("expectedStatus");
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/status edit information is missing/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires a category snapshot when an update explicitly submits a category", async () => {
    const form = productForm([{ name: "Size", value: "M" }]);
    form.set("categoryId", "active-category");
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toMatch(/Category edit information is missing/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts validated explicit dimension updates and explicit clearing", async () => {
    product.dimensions = { length: 8, width: 4 };
    const form = productForm([{ name: "Size", value: "M" }]);
    form.set("dimensions", JSON.stringify({ length: 9.5, height: 0 }));
    expect((await submit(saveProductAction, form)).searchParams.get("success")).toBe("Product updated");
    expect(product.dimensions).toEqual({ length: 9.5, height: 0 });
    const clear = productForm([{ name: "Size", value: "M" }]);
    clear.set("dimensions", "null");
    expect((await submit(saveProductAction, clear)).searchParams.get("success")).toBe("Product updated");
    expect(product.dimensions).toBeNull();
  });

  it.each([
    ["negative", '{"length":-1}'],
    ["string", '{"width":"2"}'],
    ["unknown field", '{"height":2,"unit":"cm"}'],
    ["invalid JSON", "not-json"],
    ["empty JSON", ""],
  ])("rejects %s dimensions before writing", async (_label, dimensions) => {
    product.dimensions = { length: 8 };
    const form = productForm([{ name: "Size", value: "M" }]);
    form.set("dimensions", dimensions);
    const before = structuredClone(product);
    const result = await submit(saveProductAction, form);
    expect(result.searchParams.get("error")).toBeTruthy();
    expect(product).toEqual(before);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("duplicates both legacy and canonical attributes without changing the source or history", async () => {
    const beforeProduct = structuredClone(product);
    const beforeOrder = structuredClone(orderSnapshot);
    const copy = await duplicateProduct(product.id, "owner-1");

    expect(copy.id).toBe("copy-1");
    expect(copies[0].variants.map((variant) => variant.attributes)).toEqual([
      [{ name: "Size", value: "M, tall" }, { name: "Color", value: "Black" }],
      [{ name: "Size", value: "S" }],
    ]);
    // A duplicate is a new draft with new variant IDs and zero stock; the source remains untouched.
    expect(copies[0].variants.map((variant) => variant.id)).toEqual(["copy-variant-1", "copy-variant-2"]);
    expect(copies[0].variants.map((variant) => variant.stock)).toEqual([0, 0]);
    expect(product).toEqual(beforeProduct);
    expect(orderSnapshot).toEqual(beforeOrder);
    expect(mocks.variantUpdateMany).not.toHaveBeenCalled();
    expectNoOrderWrites();
  });

  it("blocks duplication of invalid stored entries without exposing raw metadata", async () => {
    product.variants[0].attributes = [{ name: "Size", value: "M", privateMetadata: "do-not-display" }];
    const before = structuredClone(product);
    await expect(duplicateProduct(product.id, "owner-1")).rejects.toBeInstanceOf(StoredVariantAttributesError);
    expect(mocks.transaction).not.toHaveBeenCalled();

    const form = new FormData();
    form.set("id", product.id);
    const result = await submit(duplicateProductAction, form);
    expect(result.searchParams.get("error")).toContain("Cotton shirt");
    expect(result.searchParams.get("error")).toContain("Medium");
    expect(result.searchParams.get("error")).not.toContain("do-not-display");
    expect(product).toEqual(before);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNoOrderWrites();
  });
});
