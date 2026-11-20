import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, closeAll, createOwner, resetDatabase, createProduct as createTestProduct } from "../helpers";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => cookieStore.set(name, value),
    delete: (name: string) => cookieStore.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

import { createProduct, updateProduct, duplicateProduct, listProducts } from "@/services/products";
import { createLandingPage, updateLandingPage, publishLandingPage, applyTemplate } from "@/services/pages";
import { login, getCurrentUser, logout } from "@/lib/auth";
import { sectionsFromTemplate } from "@/lib/page-sections";

beforeEach(async () => {
  await resetDatabase();
  cookieStore.clear();
});

afterAll(closeAll);

const productInput = {
  name: "Test Shirt", regularPrice: 900, salePrice: 700,
  attributes: ["Size", "Color"],
  specifications: [{ name: "Fabric", value: "Cotton" }],
  images: [{ url: "/uploads/test.jpg", alt: "Shirt" }],
  variants: [{ name: "M / Black", sku: "TS-M-BLK", stock: 12, lowStockThreshold: 3, attributes: [{ name: "Size", value: "M" }], isActive: true, position: 0 }],
};

describe("product management", () => {
  it("creates, updates, duplicates and lists products with variants", async () => {
    const owner = await createOwner();
    const product = await createProduct(productInput, owner.id);
    expect(product.slug).toBe("test-shirt");
    expect(product.variants[0].stock).toBe(12);
    const updated = await updateProduct(product.id, { ...productInput, name: "Test Shirt v2", variants: [{
      ...productInput.variants[0], id: product.variants[0].id, stock: 8,
      expectedStock: product.variants[0].stock, expectedUpdatedAt: product.variants[0].updatedAt.toISOString(),
      expectedAttributes: product.variants[0].attributes,
    }] }, owner.id);
    expect(updated.name).toBe("Test Shirt v2");
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stock).toBe(8);
    const copy = await duplicateProduct(product.id, owner.id);
    expect(copy.name).toContain("Copy");
    expect(copy.status).toBe("DRAFT");
    expect(copy.variants[0].attributes).toEqual(productInput.variants[0].attributes);
    const listed = await listProducts({ search: "Test Shirt" });
    expect(listed.total).toBe(2);
  });
});

describe("landing page engine", () => {
  it("creates a page from a template, saves versions and publishes", async () => {
    const owner = await createOwner();
    const product = await createProduct(productInput, owner.id);
    const page = await createLandingPage(product.id, {
      title: "Test Shirt landing page", slug: "test-shirt", templateCode: "fashion", status: "DRAFT",
      theme: { primary: "#123456" }, seo: { title: "Test Shirt | Store" }, analytics: {}, settings: {}, noIndex: false,
      sections: [],
    }, owner.id);
    const sectionCount = (await prisma.landingPageSection.count({ where: { pageId: page.id } }));
    expect(sectionCount).toBe(sectionsFromTemplate("fashion").length);
    expect(await prisma.pageVersion.count({ where: { pageId: page.id } })).toBe(1);

    const sections = sectionsFromTemplate("general").map((section, position) => ({ ...section, position }));
    await updateLandingPage(page.id, {
      title: "Test Shirt landing page", slug: "test-shirt", templateCode: "general", status: "PUBLISHED",
      theme: { primary: "#654321" }, seo: { title: "Test Shirt | Store", description: "Real copy" }, analytics: {}, settings: {}, noIndex: false,
      sections,
    }, owner.id);
    expect(await prisma.pageVersion.count({ where: { pageId: page.id } })).toBe(2);
    const published = await publishLandingPage(page.id, owner.id, true);
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).not.toBeNull();
    await applyTemplate(page.id, "electronics", owner.id);
    expect((await prisma.landingPageSection.findMany({ where: { pageId: page.id } })).length).toBeGreaterThan(5);
  });

  it("rejects duplicate slugs and arbitrary section types", async () => {
    const owner = await createOwner();
    const a = await createProduct({
      ...productInput, name: "Alpha", variants: [{ ...productInput.variants[0], sku: "ALPHA-SKU" }],
    }, owner.id);
    const b = await createProduct({
      ...productInput, name: "Beta", variants: [{ ...productInput.variants[0], sku: "BETA-SKU" }],
    }, owner.id);
    await createLandingPage(a.id, { title: "Alpha", slug: "same-slug", theme: {}, seo: {}, analytics: {}, settings: {}, noIndex: false, sections: [] }, owner.id);
    await expect(createLandingPage(b.id, { title: "Beta", slug: "same-slug", theme: {}, seo: {}, analytics: {}, settings: {}, noIndex: false, sections: [] }, owner.id)).rejects.toThrow(/already in use/);
    await expect(createLandingPage(b.id, { title: "Beta", slug: "beta", templateCode: "general", status: "DRAFT", theme: {}, seo: {}, analytics: {}, settings: {}, noIndex: false, sections: [{ type: "evil_script" as never, data: {} }] }, owner.id)).rejects.toThrow();
  });
});

describe("authentication and sessions", () => {
  it("logs in, restores a session, and revokes it on logout", async () => {
    const email = `auth-${Math.random().toString(36).slice(2, 9)}@landiq.local`;
    const user = await prisma.user.create({
      data: { name: "Auth User", email, passwordHash: await bcrypt.hash("SecurePassword123", 10) },
    });
    await login(email, "SecurePassword123");
    expect(cookieStore.has("landiq_session")).toBe(true);
    const current = await getCurrentUser();
    expect(current?.id).toBe(user.id);
    await logout();
    expect((await getCurrentUser())?.id).toBeUndefined();
  });

  it("rejects incorrect passwords", async () => {
    const email = `bad-${Math.random().toString(36).slice(2, 9)}@landiq.local`;
    await prisma.user.create({ data: { name: "Bad Login", email, passwordHash: await bcrypt.hash("CorrectPassword123", 10) } });
    await expect(login(email, "WrongPassword123")).rejects.toThrow(/Invalid email or password/);
  });
});
