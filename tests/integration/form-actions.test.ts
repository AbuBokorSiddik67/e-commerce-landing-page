import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, closeAll, createOwner, createProduct as createTestProduct, resetDatabase } from "../helpers";

const auth = vi.hoisted(() => ({ actorId: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requirePermission: async (permission: string) => {
    auth.permissions.push(permission);
    return { id: auth.actorId };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => { throw new Error(`TEST_REDIRECT:${location}`); },
}));

import { saveProductAction } from "@/app/actions/products";
import { savePageAction } from "@/app/actions/pages";
import { pageSchema } from "@/services/pages";
import { productSchema } from "@/services/products";
import { PERMISSIONS } from "@/lib/permissions";

beforeEach(async () => {
  await resetDatabase();
  auth.actorId = (await createOwner()).id;
  auth.permissions.length = 0;
});
afterAll(closeAll);

async function submit(action: (formData: FormData) => Promise<void>, data: FormData) {
  try {
    await action(data);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TEST_REDIRECT:")) {
      return new URL(error.message.slice("TEST_REDIRECT:".length), "http://localhost");
    }
    throw error;
  }
  throw new Error("The action did not redirect");
}

const variants = [
  { name: "Small / Black", sku: "FORM-S", stock: 10, lowStockThreshold: 2, attributes: [{ name: "Size", value: "S" }, { name: "Color", value: "Black" }], isActive: true, position: 0 },
  { name: "Medium / Blue", sku: "FORM-M", stock: 8, lowStockThreshold: 2, attributes: [{ name: "Size", value: "M" }, { name: "Color", value: "Blue" }], isActive: true, position: 1 },
  { name: "Large / Red", sku: "FORM-L", stock: 6, lowStockThreshold: 2, attributes: [{ name: "Size", value: "L" }, { name: "Color", value: "Red" }], isActive: false, position: 2 },
];

function productForm(variantData: unknown) {
  const data = new FormData();
  data.set("name", "Form shirt");
  data.set("regularPrice", "900");
  data.set("status", "DRAFT");
  data.set("variants", JSON.stringify(variantData));
  data.set("attributes", JSON.stringify(["Size", "Color"]));
  data.set("specifications", "[]");
  data.set("images", "[]");
  return data;
}

function pageForm(id: string, seo: unknown, settings: unknown) {
  const data = new FormData();
  data.set("id", id);
  data.set("title", "Updated landing page");
  data.set("slug", "form-page");
  data.set("templateCode", "general");
  data.set("status", "DRAFT");
  data.set("theme", JSON.stringify({ primary: "#123456" }));
  data.set("seo", JSON.stringify(seo));
  data.set("settings", JSON.stringify(settings));
  data.set("analytics", "{}");
  data.set("sections", "[]");
  return data;
}

describe("strict form schemas", () => {
  it("continues to reject the originally reported variant and builder shapes", () => {
    const product = productSchema.safeParse({
      name: "Form shirt", regularPrice: 900,
      variants: variants.map((variant) => ({ ...variant, attributes: { Size: "M" } })),
    });
    expect(product.success).toBe(false);
    if (product.success) throw new Error("Expected invalid variant attributes");
    expect(product.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "variants.0.attributes", "variants.1.attributes", "variants.2.attributes",
    ]);

    const page = pageSchema.safeParse({
      title: "Form page", slug: "form-page", seo: { noIndex: "false" },
      settings: { showStickyCta: "true", showRelatedProducts: "false" },
    });
    expect(page.success).toBe(false);
    if (page.success) throw new Error("Expected invalid builder booleans");
    expect(page.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "seo.noIndex", "settings.showStickyCta", "settings.showRelatedProducts",
    ]);
  });
});

describe("product form action and persistence", () => {
  it("creates multiple variants and updates them without replacing IDs or relationships", async () => {
    const create = productForm(variants);
    create.set("isFeatured", "on");
    expect((await submit(saveProductAction, create)).searchParams.get("success")).toBe("Product created");
    expect(auth.permissions).toContain(PERMISSIONS.PRODUCT_WRITE);

    const product = await prisma.product.findUniqueOrThrow({
      where: { slug: "form-shirt" },
      include: { variants: { orderBy: { position: "asc" } }, landingPage: true },
    });
    expect(product.isFeatured).toBe(true);
    expect(product.variants.map((variant) => variant.attributes)).toEqual(variants.map((variant) => variant.attributes));
    expect(product.variants.map((variant) => variant.isActive)).toEqual([true, true, false]);
    expect(product.landingPage?.productId).toBe(product.id);

    const movement = await prisma.stockMovement.create({
      data: { productId: product.id, variantId: product.variants[0].id, type: "PURCHASE", quantity: 10, balanceAfter: 10 },
    });
    const movementCounts = await Promise.all(product.variants.map((variant) =>
      prisma.stockMovement.count({ where: { variantId: variant.id } })));
    const updatedVariants = variants.map((variant, index) => ({
      ...variant, id: product.variants[index].id,
      expectedStock: product.variants[index].stock, expectedMovementCount: movementCounts[index],
      expectedUpdatedAt: product.variants[index].updatedAt.toISOString(),
      expectedAttributes: product.variants[index].attributes,
      attributes: index === 1 ? [{ name: "Size", value: "M" }, { name: "Color", value: "Green" }] : variant.attributes,
      isActive: index !== 1,
    }));
    const update = productForm(updatedVariants);
    update.set("id", product.id);
    update.set("expectedStatus", product.status);
    update.set("name", "Updated shirt");
    // isFeatured is absent, as it is when a native checkbox is unchecked.
    expect((await submit(saveProductAction, update)).searchParams.get("success")).toBe("Product updated");
    const saved = await prisma.product.findUniqueOrThrow({
      where: { id: product.id }, include: { variants: { orderBy: { position: "asc" } }, landingPage: true },
    });
    expect(saved.name).toBe("Updated shirt");
    expect(saved.isFeatured).toBe(false);
    expect(saved.variants.map((variant) => variant.id)).toEqual(product.variants.map((variant) => variant.id));
    expect(saved.variants.map((variant) => variant.attributes)).toEqual(updatedVariants.map((variant) => variant.attributes));
    expect(saved.variants.map((variant) => variant.isActive)).toEqual([true, false, true]);
    expect(saved.landingPage?.id).toBe(product.landingPage?.id);
    expect((await prisma.stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).variantId).toBe(product.variants[0].id);
  });

  it("rejects object-shaped attributes and malformed JSON rather than discarding data", async () => {
    const objectAttributes = productForm([{ ...variants[0], attributes: { Size: "S" } }]);
    const rejected = await submit(saveProductAction, objectAttributes);
    expect(rejected.searchParams.get("error")).toContain("Expected array, received object");
    expect(await prisma.product.count()).toBe(0);

    const invalidAttribute = productForm([{ ...variants[0], attributes: [{ name: "", value: "S" }] }]);
    expect((await submit(saveProductAction, invalidAttribute)).searchParams.get("error")).toContain("String must contain at least 1 character");
    expect(await prisma.product.count()).toBe(0);

    const invalidJson = productForm(variants);
    invalidJson.set("variants", "[broken");
    expect((await submit(saveProductAction, invalidJson)).searchParams.get("error")).toBe("Invalid JSON for variants");
    expect(await prisma.product.count()).toBe(0);

    const invalidCheckbox = productForm(variants);
    invalidCheckbox.set("isFeatured", "perhaps");
    expect((await submit(saveProductAction, invalidCheckbox)).searchParams.get("error")).toBe("Invalid checkbox value for isFeatured");
    expect(await prisma.product.count()).toBe(0);
  });
});

describe("landing page form action and persistence", () => {
  it("saves checked and unchecked builder options as booleans while retaining SEO and settings", async () => {
    const product = await createTestProduct({ slug: "form-page" });
    const page = await prisma.landingPage.findUniqueOrThrow({ where: { productId: product.id } });
    const checked = pageForm(page.id,
      { title: "SEO title", description: "SEO description", noIndex: true },
      { whatsappNumber: "01700000000", primaryCtaText: "Buy now", showStickyCta: true, showRelatedProducts: false },
    );
    checked.set("noIndex", "on");
    expect((await submit(savePageAction, checked)).searchParams.get("success")).toBe("Draft saved");
    expect(auth.permissions).toContain(PERMISSIONS.PAGE_WRITE);
    let saved = await prisma.landingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(saved.noIndex).toBe(true);
    expect(saved.seo).toEqual({ title: "SEO title", description: "SEO description", noIndex: true });
    expect(saved.settings).toEqual({ whatsappNumber: "01700000000", primaryCtaText: "Buy now", showStickyCta: true, showRelatedProducts: false });

    const unchecked = pageForm(page.id,
      { title: "SEO title", description: "SEO description", noIndex: false },
      { whatsappNumber: "01700000000", primaryCtaText: "Buy now", showStickyCta: false, showRelatedProducts: true },
    );
    // The top-level checkbox is omitted entirely to represent an unchecked control.
    expect((await submit(savePageAction, unchecked)).searchParams.get("success")).toBe("Draft saved");
    saved = await prisma.landingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(saved.noIndex).toBe(false);
    expect(saved.seo).toEqual({ title: "SEO title", description: "SEO description", noIndex: false });
    expect(saved.settings).toEqual({ whatsappNumber: "01700000000", primaryCtaText: "Buy now", showStickyCta: false, showRelatedProducts: true });
    expect(await prisma.pageVersion.count({ where: { pageId: page.id } })).toBe(2);
  });

  it("retains saved sections and creates newly added sections when saving the builder", async () => {
    const product = await createTestProduct({ slug: "form-page" });
    const page = await prisma.landingPage.findUniqueOrThrow({ where: { productId: product.id } });
    const existing = await prisma.landingPageSection.create({
      data: { pageId: page.id, type: "hero", data: { title: "Original" }, enabled: true, position: 0 },
    });
    const form = pageForm(page.id, { noIndex: false }, { showStickyCta: true, showRelatedProducts: false });
    form.set("sections", JSON.stringify([
      { id: existing.id, type: "hero", data: { title: "Updated" }, enabled: true, position: 0 },
      { type: "faq", data: { title: "New FAQ" }, enabled: true, position: 1 },
    ]));
    expect((await submit(savePageAction, form)).searchParams.get("success")).toBe("Draft saved");
    const sections = await prisma.landingPageSection.findMany({ where: { pageId: page.id }, orderBy: { position: "asc" } });
    expect(sections).toHaveLength(2);
    expect(sections[0]).toEqual(expect.objectContaining({ id: existing.id, pageId: page.id, data: { title: "Updated" } }));
    expect(sections[1]).toEqual(expect.objectContaining({ pageId: page.id, type: "faq", data: { title: "New FAQ" } }));
    expect(sections[1].id).not.toBe(existing.id);
  });

  it("normalizes only known legacy boolean literals before strict validation", async () => {
    const product = await createTestProduct({ slug: "form-page" });
    const page = await prisma.landingPage.findUniqueOrThrow({ where: { productId: product.id } });
    const legacy = pageForm(page.id, { title: "Legacy", noIndex: "true" }, { showStickyCta: "false", showRelatedProducts: "true" });
    legacy.set("noIndex", "true");
    expect((await submit(savePageAction, legacy)).searchParams.get("success")).toBe("Draft saved");
    const saved = await prisma.landingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(saved.noIndex).toBe(true);
    expect(saved.seo).toEqual({ title: "Legacy", noIndex: true });
    expect(saved.settings).toEqual({ showStickyCta: false, showRelatedProducts: true });

    const invalid = pageForm(page.id, { noIndex: "sometimes" }, { showStickyCta: "no", showRelatedProducts: "true" });
    const response = await submit(savePageAction, invalid);
    expect(response.searchParams.get("error")).toContain("Expected boolean, received string");
    const unchanged = await prisma.landingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(unchanged.seo).toEqual(saved.seo);
    expect(unchanged.settings).toEqual(saved.settings);
    expect(pageSchema.safeParse({ title: "Valid title", slug: "form-page", seo: { noIndex: "false" } }).success).toBe(false);

    const invalidCheckbox = pageForm(page.id, { noIndex: false }, {});
    invalidCheckbox.set("noIndex", "perhaps");
    expect((await submit(savePageAction, invalidCheckbox)).searchParams.get("error")).toBe("Invalid checkbox value for noIndex");
    expect((await prisma.landingPage.findUniqueOrThrow({ where: { id: page.id } })).noIndex).toBe(true);
  });

  it("rejects malformed settings JSON rather than silently resetting the settings", async () => {
    const product = await createTestProduct({ slug: "form-page" });
    const page = await prisma.landingPage.update({ where: { productId: product.id }, data: { settings: { showStickyCta: false } } });
    const form = pageForm(page.id, {}, {});
    form.set("settings", "{broken");
    expect((await submit(savePageAction, form)).searchParams.get("error")).toBe("Invalid JSON for settings");
    expect((await prisma.landingPage.findUniqueOrThrow({ where: { id: page.id } })).settings).toEqual({ showStickyCta: false });
  });
});
