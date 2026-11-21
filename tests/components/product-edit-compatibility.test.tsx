// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findProduct: vi.fn(), findCategories: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findUnique: db.findProduct }, category: { findMany: db.findCategories } },
}));
vi.mock("@/app/actions/products", () => ({ saveProductAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePageAccess: vi.fn().mockResolvedValue({ id: "fixture-viewer" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import EditProduct from "@/app/dashboard/products/[id]/page";

function productWith(attributes: unknown) {
  return {
    id: "product-1", name: "Cotton shirt", slug: "cotton-shirt", sku: null,
    shortDescription: null, description: null, regularPrice: 500, salePrice: null,
    categoryId: null, status: "DRAFT", isFeatured: false, videoUrl: null, weightGrams: null,
    attributes: ["Size", "Color"], specifications: [], images: [],
    variants: [{
      id: "variant-1", productId: "product-1", name: "Medium", sku: "MEDIUM", price: null,
      stock: 7, lowStockThreshold: 2, imageUrl: null, attributes, isActive: true, position: 0,
      updatedAt: new Date("2025-01-01T00:00:00.000Z"), _count: { movements: 1 },
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findCategories.mockResolvedValue([]);
});
afterEach(cleanup);

async function renderEditor(attributes: unknown) {
  db.findProduct.mockResolvedValue(productWith(attributes));
  return render(await EditProduct({ params: Promise.resolve({ id: "product-1" }) }));
}

function submittedVariants(container: HTMLElement): unknown {
  const form = container.querySelector("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("Expected product form");
  const value = new FormData(form).get("variants");
  if (typeof value !== "string") throw new Error("Expected variants JSON");
  return JSON.parse(value) as unknown;
}

describe("product edit page attribute compatibility", () => {
  it.each([
    ["canonical", [{ name: "Size", value: "M, tall" }, { name: "Color", value: "Black" }]],
    ["legacy", { Size: "M, tall", Color: "Black" }],
  ])("loads %s attributes and preserves them when another field is edited", async (_shape, attributes) => {
    const { container } = await renderEditor(attributes);
    expect(screen.getAllByLabelText(/^Attribute name/).map((input) => (input as HTMLTextAreaElement).value)).toEqual(["Size", "Color"]);
    expect(screen.getAllByLabelText("Attribute value").map((input) => (input as HTMLTextAreaElement).value)).toEqual(["M, tall", "Black"]);
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: "Updated shirt" } });
    expect(submittedVariants(container)).toEqual([
      expect.objectContaining({
        id: "variant-1", name: "Medium", stock: 7,
        attributes: [{ name: "Size", value: "M, tall" }, { name: "Color", value: "Black" }],
      }),
    ]);
    expect(db.findProduct).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "product-1" } }));
  });

  it("retains mixed original line endings across a single edit on both sides", async () => {
    const { container } = await renderEditor([{ name: "Multiline", value: "alpha\r\nbeta\rgamma" }]);
    fireEvent.change(screen.getByLabelText("Attribute value"), { target: { value: "ALPHA\nbeta\nGAMMA" } });
    expect(submittedVariants(container)).toEqual([
      expect.objectContaining({ attributes: [{ name: "Multiline", value: "ALPHA\r\nbeta\rGAMMA" }] }),
    ]);
  });

  it("prioritizes preserving a line ending even when surrounding text is replaced", async () => {
    const { container } = await renderEditor([{ name: "Multiline", value: "A\r\nB" }]);
    fireEvent.change(screen.getByLabelText("Attribute value"), { target: { value: "B\nA" } });
    expect(submittedVariants(container)).toEqual([
      expect.objectContaining({ attributes: [{ name: "Multiline", value: "B\r\nA" }] }),
    ]);
  });

  it("shows a contextual error without rendering a lossy form or exposing raw metadata", async () => {
    const { container } = await renderEditor([{ name: "Size", value: "M", secret: "do-not-display" }]);
    expect(screen.getByRole("alert")).toHaveTextContent("Cotton shirt");
    expect(screen.getByRole("alert")).toHaveTextContent("Medium");
    expect(screen.getByRole("alert")).toHaveTextContent("unsupported fields");
    expect(screen.getByRole("alert")).not.toHaveTextContent("do-not-display");
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to products" })).toHaveAttribute("href", "/dashboard/products");
  });
});
