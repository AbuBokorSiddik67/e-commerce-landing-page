// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductForm } from "@/components/dashboard/ProductForm";
import { PageBuilder } from "@/components/dashboard/PageBuilder";

vi.mock("@/app/actions/products", () => ({ saveProductAction: vi.fn() }));
vi.mock("@/app/actions/pages", () => ({
  savePageAction: vi.fn(), applyTemplateAction: vi.fn(), publishPageAction: vi.fn(),
}));

afterEach(cleanup);

function formData(container: HTMLElement, selector = "form") {
  const form = container.querySelector(selector);
  if (!(form instanceof HTMLFormElement)) throw new Error("Expected a form");
  return new FormData(form);
}

function jsonField(data: FormData, key: string): unknown {
  const raw = data.get(key);
  if (typeof raw !== "string") throw new Error(`Missing ${key}`);
  return JSON.parse(raw);
}

describe("product form serialization", () => {
  it("submits multiple variants as arrays of attributes and serializes checkbox state", () => {
    const { container } = render(<ProductForm categories={[]} />);
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: "Cotton shirt" } });
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));

    const names = screen.getAllByLabelText("Variant name");
    const attributes = screen.getAllByLabelText(/^Attributes/);
    ["Small", "Medium", "Large"].forEach((name, index) => {
      fireEvent.change(names[index], { target: { value: name } });
    });
    ["Size: S, Color: Black", "Size: M, Color: Blue", "Size: L, Color: Red"].forEach((value, index) => {
      fireEvent.change(attributes[index], { target: { value } });
    });
    fireEvent.click(screen.getAllByLabelText("Active")[1]);
    fireEvent.click(screen.getByLabelText("Feature this product"));

    const data = formData(container);
    expect(jsonField(data, "variants")).toEqual([
      expect.objectContaining({ name: "Small", attributes: [{ name: "Size", value: "S" }, { name: "Color", value: "Black" }], isActive: true }),
      expect.objectContaining({ name: "Medium", attributes: [{ name: "Size", value: "M" }, { name: "Color", value: "Blue" }], isActive: false }),
      expect.objectContaining({ name: "Large", attributes: [{ name: "Size", value: "L" }, { name: "Color", value: "Red" }], isActive: true }),
    ]);
    expect(data.get("isFeatured")).toBe("on");
    fireEvent.click(screen.getByLabelText("Feature this product"));
    expect(formData(container).has("isFeatured")).toBe(false);

    fireEvent.click(screen.getAllByRole("button", { name: /Remove/ })[1]);
    expect(screen.getAllByLabelText(/^Attributes/).map((input) => (input as HTMLInputElement).value)).toEqual(["Size: S, Color: Black", "Size: L, Color: Red"]);
    expect(jsonField(formData(container), "variants")).toEqual([
      expect.objectContaining({ name: "Small", attributes: [{ name: "Size", value: "S" }, { name: "Color", value: "Black" }] }),
      expect.objectContaining({ name: "Large", attributes: [{ name: "Size", value: "L" }, { name: "Color", value: "Red" }] }),
    ]);
  });

  it("loads existing attribute arrays and keeps the displayed data aligned after removing a variant", () => {
    const { container } = render(<ProductForm categories={[]} product={{
      id: "product-1", name: "Shirt", slug: "shirt", sku: null, shortDescription: null,
      description: null, regularPrice: 500, salePrice: null, categoryId: null,
      status: "DRAFT", isFeatured: false, videoUrl: null, weightGrams: null,
      attributes: ["Size"], specifications: [], images: [],
      variants: [
        { id: "v1", name: "Small", sku: null, price: null, stock: 3, lowStockThreshold: 1, imageUrl: null, attributes: [{ name: "Size", value: "S" }], isActive: true },
        { id: "v2", name: "Medium", sku: null, price: null, stock: 4, lowStockThreshold: 1, imageUrl: null, attributes: [{ name: "Size", value: "M" }], isActive: true },
        { id: "v3", name: "Large", sku: null, price: null, stock: 5, lowStockThreshold: 1, imageUrl: null, attributes: [{ name: "Size", value: "L" }], isActive: false },
      ],
    }} />);
    expect(screen.getAllByLabelText(/^Attributes/).map((input) => (input as HTMLInputElement).value)).toEqual(["Size: S", "Size: M", "Size: L"]);
    fireEvent.click(screen.getAllByRole("button", { name: /Remove/ })[1]);
    expect(screen.getAllByLabelText(/^Attributes/).map((input) => (input as HTMLInputElement).value)).toEqual(["Size: S", "Size: L"]);
    fireEvent.change(screen.getAllByLabelText(/^Attributes/)[1], { target: { value: "Size: XL, Color: Navy" } });
    expect(jsonField(formData(container), "variants")).toEqual([
      expect.objectContaining({ id: "v1", attributes: [{ name: "Size", value: "S" }] }),
      expect.objectContaining({ id: "v3", attributes: [{ name: "Size", value: "XL" }, { name: "Color", value: "Navy" }], isActive: false }),
    ]);
  });
});

describe("landing page builder serialization", () => {
  it("preserves SEO text and emits actual booleans for checked and unchecked options", () => {
    const { container } = render(<PageBuilder page={{
      id: "page-1", slug: "cotton-shirt", title: "Cotton shirt", status: "DRAFT", templateCode: "general",
      theme: {}, seo: { title: "Existing SEO title", description: "Existing description" },
      settings: { whatsappNumber: "01700000000", primaryCtaText: "Buy now", showStickyCta: true, showRelatedProducts: false },
      noIndex: false, scheduledFor: null,
      product: { name: "Shirt", slug: "shirt", regularPrice: 500, salePrice: null, images: [] },
    }} sections={[]} templates={[]} />);

    let data = formData(container, "#page-form");
    expect(jsonField(data, "seo")).toEqual({ title: "Existing SEO title", description: "Existing description", noIndex: false });
    expect(jsonField(data, "settings")).toEqual({ whatsappNumber: "01700000000", primaryCtaText: "Buy now", showStickyCta: true, showRelatedProducts: false });
    expect(data.get("noIndex")).toBe("false");

    fireEvent.click(screen.getByLabelText("Do not index this page"));
    fireEvent.click(screen.getByLabelText("Show sticky call to action"));
    fireEvent.click(screen.getByLabelText("Show related products"));
    data = formData(container, "#page-form");
    expect(jsonField(data, "seo")).toEqual(expect.objectContaining({ noIndex: true }));
    expect(jsonField(data, "settings")).toEqual(expect.objectContaining({ showStickyCta: false, showRelatedProducts: true }));
    expect(data.get("noIndex")).toBe("true");

    fireEvent.click(screen.getByLabelText("Do not index this page"));
    data = formData(container, "#page-form");
    expect(jsonField(data, "seo")).toEqual(expect.objectContaining({ noIndex: false }));
    expect(data.get("noIndex")).toBe("false");
  });

  it("sends existing section IDs but omits temporary IDs for added and duplicated sections", () => {
    const { container } = render(<PageBuilder page={{
      id: "page-1", slug: "cotton-shirt", title: "Cotton shirt", status: "DRAFT", templateCode: "general",
      theme: {}, seo: {}, settings: {}, noIndex: false, scheduledFor: null,
      product: { name: "Shirt", slug: "shirt", regularPrice: 500, salePrice: null, images: [] },
    }} sections={[{ id: "saved-1", type: "hero", data: { title: "Existing" }, enabled: true, position: 0 }]} templates={[]} />);
    fireEvent.change(screen.getByLabelText("Add a section"), { target: { value: "faq" } });
    fireEvent.click(screen.getByTitle("Duplicate"));
    const submitted = jsonField(formData(container, "#page-form"), "sections");
    expect(Array.isArray(submitted)).toBe(true);
    if (!Array.isArray(submitted)) throw new Error("Expected sections array");
    expect(submitted).toHaveLength(3);
    expect(submitted[0]).toEqual(expect.objectContaining({ id: "saved-1", type: "hero" }));
    expect(submitted[1]).toEqual(expect.objectContaining({ type: "faq" }));
    expect(submitted[2]).toEqual(expect.objectContaining({ type: "faq" }));
    expect(Object.hasOwn(submitted[1], "id")).toBe(false);
    expect(Object.hasOwn(submitted[2], "id")).toBe(false);
  });
});
