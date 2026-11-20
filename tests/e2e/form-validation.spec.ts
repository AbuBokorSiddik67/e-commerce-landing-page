import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

const prisma = new PrismaClient();
test.afterAll(() => prisma.$disconnect());

test("product variants and builder checkboxes survive real form submissions", async ({ page }) => {
  const slug = `form-validation-${randomUUID()}`;
  const name = `Form shirt ${slug}`;
  try {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(process.env.E2E_OWNER_EMAIL ?? "owner@landiq.local");
    await page.locator('input[name="password"]').fill(process.env.E2E_OWNER_PASSWORD ?? "Owner@123456789");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/dashboard/products/new");
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="slug"]').fill(slug);
    await page.locator('input[name="regularPrice"]').fill("900");
    await page.getByRole("button", { name: "Add variant" }).click();
    await page.getByRole("button", { name: "Add variant" }).click();
    const names = page.locator('input[id^="v-name-"]');
    for (const [index, size] of ["S", "M", "L"].entries()) {
      await names.nth(index).fill(`Size ${size}`);
      const attributes = page.getByRole("group", { name: `Attributes for Size ${size}` });
      await attributes.getByRole("button", { name: `Add attribute to Size ${size}` }).click();
      await attributes.getByLabel("Attribute name").fill("Size");
      await attributes.getByLabel("Attribute value").fill(size);
      await attributes.getByRole("button", { name: `Add attribute to Size ${size}` }).click();
      await attributes.getByLabel("Attribute name").nth(1).fill("Color");
      await attributes.getByLabel("Attribute value").nth(1).fill("Black");
    }
    await page.getByLabel("Feature this product").check();
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("status")).toHaveText("Product created");

    const created = await prisma.product.findUniqueOrThrow({
      where: { slug }, include: { variants: { orderBy: { position: "asc" } }, landingPage: true },
    });
    expect(created.isFeatured).toBe(true);
    expect(created.variants.map((variant) => variant.attributes)).toEqual(["S", "M", "L"].map((size) => [
      { name: "Size", value: size }, { name: "Color", value: "Black" },
    ]));
    if (!created.landingPage) throw new Error("Product did not receive a landing page");

    await page.getByRole("link", { name, exact: true }).click();
    const medium = page.getByRole("group", { name: "Attributes for Size M" });
    await expect(medium.getByLabel("Attribute name").nth(0)).toHaveValue("Size");
    await expect(medium.getByLabel("Attribute value").nth(1)).toHaveValue("Black");
    await medium.getByLabel("Attribute value").nth(1).fill("Green");
    await page.getByLabel("Feature this product").uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Product updated");
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: created.id }, include: { variants: { orderBy: { position: "asc" } } } });
    expect(updated.isFeatured).toBe(false);
    expect(updated.variants.map((variant) => variant.id)).toEqual(created.variants.map((variant) => variant.id));
    expect(updated.variants[1].attributes).toEqual([{ name: "Size", value: "M" }, { name: "Color", value: "Green" }]);

    const builderPath = `/dashboard/pages/${created.landingPage.id}/builder`;
    await page.goto(builderPath);
    await page.locator("#seo-title").fill("A real SEO title");
    await page.getByLabel("Do not index this page").check();
    await page.getByLabel("Show sticky call to action").uncheck();
    await page.getByLabel("Show related products").uncheck();
    await page.getByLabel("Add a section").selectOption("faq");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === builderPath),
      page.getByRole("button", { name: "Save draft" }).click(),
    ]);
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    await expect(page.getByLabel("Do not index this page")).toBeChecked();
    await expect(page.getByLabel("Show sticky call to action")).not.toBeChecked();
    await expect(page.getByLabel("Show related products")).not.toBeChecked();
    await expect(page.locator("#seo-title")).toHaveValue("A real SEO title");
    let savedPage = await prisma.landingPage.findUniqueOrThrow({ where: { id: created.landingPage.id }, include: { sections: true } });
    expect(savedPage.noIndex).toBe(true);
    expect(savedPage.seo).toEqual({ title: "A real SEO title", noIndex: true });
    expect(savedPage.settings).toEqual(expect.objectContaining({ showStickyCta: false, showRelatedProducts: false }));
    expect(savedPage.sections.some((section) => section.type === "faq")).toBe(true);

    await page.getByLabel("Do not index this page").uncheck();
    await page.getByLabel("Show sticky call to action").check();
    await page.getByLabel("Show related products").check();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === builderPath),
      page.getByRole("button", { name: "Save draft" }).click(),
    ]);
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    savedPage = await prisma.landingPage.findUniqueOrThrow({ where: { id: created.landingPage.id }, include: { sections: true } });
    expect(savedPage.noIndex).toBe(false);
    expect(savedPage.seo).toEqual({ title: "A real SEO title", noIndex: false });
    expect(savedPage.settings).toEqual(expect.objectContaining({ showStickyCta: true, showRelatedProducts: true }));
    expect(savedPage.sections.some((section) => section.type === "faq")).toBe(true);
  } finally {
    await prisma.product.deleteMany({ where: { slug } });
  }
});
