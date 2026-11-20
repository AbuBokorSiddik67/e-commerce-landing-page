// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    ["Small", "Medium", "Large"].forEach((name, index) => {
      fireEvent.change(names[index], { target: { value: name } });
    });
    [["Small", "S", "Black"], ["Medium", "M", "Blue"], ["Large", "L", "Red"]].forEach(([variant, size, color]) => {
      const group = within(screen.getByRole("group", { name: `Attributes for ${variant}` }));
      fireEvent.click(group.getByRole("button", { name: `Add attribute to ${variant}` }));
      fireEvent.change(group.getByLabelText(/^Attribute name/), { target: { value: "Size" } });
      fireEvent.change(group.getByLabelText("Attribute value"), { target: { value: size } });
      fireEvent.click(group.getByRole("button", { name: `Add attribute to ${variant}` }));
      fireEvent.change(group.getAllByLabelText(/^Attribute name/)[1], { target: { value: "Color" } });
      fireEvent.change(group.getAllByLabelText("Attribute value")[1], { target: { value: color } });
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

    const largeName = within(screen.getByRole("group", { name: "Attributes for Large" })).getAllByLabelText(/^Attribute name/)[0];
    fireEvent.click(screen.getByRole("button", { name: "Remove new variant Medium" }));
    expect(within(screen.getByRole("group", { name: "Attributes for Large" })).getAllByLabelText(/^Attribute name/)[0]).toBe(largeName);
    expect(screen.queryByRole("group", { name: "Attributes for Medium" })).not.toBeInTheDocument();
    expect(jsonField(formData(container), "variants")).toEqual([
      expect.objectContaining({ name: "Small", attributes: [{ name: "Size", value: "S" }, { name: "Color", value: "Black" }] }),
      expect.objectContaining({ name: "Large", attributes: [{ name: "Size", value: "L" }, { name: "Color", value: "Red" }] }),
    ]);
  });

  it("adds, edits and removes individual rows without parsing punctuation or losing whitespace", () => {
    const { container } = render(<ProductForm categories={[]} />);
    const group = within(screen.getByRole("group", { name: "Attributes for Default" }));
    fireEvent.click(group.getByRole("button", { name: "Add attribute to Default" }));
    fireEvent.change(group.getByLabelText(/^Attribute name/), { target: { value: " Size,: \t" } });
    fireEvent.change(group.getByLabelText("Attribute value"), { target: { value: " M, tall: \n " } });
    fireEvent.click(group.getByRole("button", { name: "Add attribute to Default" }));
    const retainedName = group.getAllByLabelText(/^Attribute name/)[1];
    fireEvent.change(retainedName, { target: { value: " Color: " } });
    fireEvent.change(group.getAllByLabelText("Attribute value")[1], { target: { value: "Navy, blue" } });
    expect(jsonField(formData(container), "variants")).toEqual([
      expect.objectContaining({ attributes: [{ name: " Size,: \t", value: " M, tall: \n " }, { name: " Color: ", value: "Navy, blue" }] }),
    ]);
    fireEvent.click(group.getByRole("button", { name: "Remove attribute 1 from Default" }));
    expect(group.getByLabelText(/^Attribute name/)).toBe(retainedName);
    expect(jsonField(formData(container), "variants")).toEqual([
      expect.objectContaining({ attributes: [{ name: " Color: ", value: "Navy, blue" }] }),
    ]);
    fireEvent.click(group.getByRole("button", { name: "Remove attribute 1 from Default" }));
    expect(jsonField(formData(container), "variants")).toEqual([expect.objectContaining({ attributes: [] })]);
  });

  it("preserves empty values, exposes required names, and prevents adding more than ten rows", () => {
    const { container } = render(<ProductForm categories={[]} />);
    const group = within(screen.getByRole("group", { name: "Attributes for Default" }));
    for (let index = 0; index < 10; index++) {
      fireEvent.click(group.getByRole("button", { name: "Add attribute to Default" }));
      fireEvent.change(group.getAllByLabelText(/^Attribute name/)[index], { target: { value: `Name ${index}` } });
    }
    expect(group.getByRole("button", { name: "Add attribute to Default" })).toBeDisabled();
    expect(group.getAllByLabelText(/^Attribute name/)[0]).toBeRequired();
    expect(group.getAllByLabelText("Attribute value")[0]).not.toBeRequired();
    expect(jsonField(formData(container), "variants")).toEqual([
      expect.objectContaining({ attributes: Array.from({ length: 10 }, (_, index) => ({ name: `Name ${index}`, value: "" })) }),
    ]);
  });

  it("keeps existing variants and allows deactivation without dropping their IDs", () => {
    const { container } = render(<ProductForm categories={[]} product={{
      id: "product-1", name: "Shirt", slug: "shirt", sku: null, shortDescription: null,
      description: null, regularPrice: 500, salePrice: null, categoryId: null,
      status: "DRAFT", isFeatured: false, videoUrl: null, weightGrams: null,
      attributes: ["Size"], specifications: [], images: [],
      variants: [
        { id: "v1", name: "Small", sku: null, price: null, stock: 3, lowStockThreshold: 1, imageUrl: null, attributes: [{ name: "Size", value: "S" }], expectedAttributes: [{ name: "Size", value: "S" }], updatedAt: new Date("2025-01-01T00:00:00.000Z"), isActive: true },
        { id: "v2", name: "Medium", sku: null, price: null, stock: 4, lowStockThreshold: 1, imageUrl: null, attributes: [{ name: "Size", value: "M" }], expectedAttributes: [{ name: "Size", value: "M" }], updatedAt: new Date("2025-01-01T00:00:00.000Z"), isActive: true },
        { id: "v3", name: "Large", sku: null, price: null, stock: 5, lowStockThreshold: 1, imageUrl: null, attributes: [{ name: "Size", value: "L" }], expectedAttributes: [{ name: "Size", value: "L" }], updatedAt: new Date("2025-01-01T00:00:00.000Z"), isActive: false },
      ],
    }} />);
    expect(screen.getAllByLabelText("Attribute value").map((input) => (input as HTMLTextAreaElement).value)).toEqual(["S", "M", "L"]);
    expect(screen.queryByRole("button", { name: /Remove new variant/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Active")[1]);
    const large = within(screen.getByRole("group", { name: "Attributes for Large" }));
    fireEvent.change(large.getByLabelText("Attribute value"), { target: { value: "XL" } });
    fireEvent.click(large.getByRole("button", { name: "Add attribute to Large" }));
    fireEvent.change(large.getAllByLabelText(/^Attribute name/)[1], { target: { value: "Color" } });
    fireEvent.change(large.getAllByLabelText("Attribute value")[1], { target: { value: "Navy" } });
    expect(jsonField(formData(container), "variants")).toEqual([
      expect.objectContaining({ id: "v1", expectedStock: 3, attributes: [{ name: "Size", value: "S" }] }),
      expect.objectContaining({ id: "v2", expectedStock: 4, attributes: [{ name: "Size", value: "M" }], isActive: false }),
      expect.objectContaining({ id: "v3", expectedStock: 5, attributes: [{ name: "Size", value: "XL" }, { name: "Color", value: "Navy" }], isActive: false }),
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
