"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { saveProductAction } from "@/app/actions/products";
import { Button, Card, Field } from "@/components/ui";
import type { VariantAttribute } from "@/lib/product-attributes";

type AttributeRow = VariantAttribute & { uiKey: string };
type Variant = {
  uiKey: string; id?: string; name: string; sku: string; price: string; stock: string;
  expectedStock?: number; expectedMovementCount?: number; expectedUpdatedAt?: string; expectedAttributes?: unknown;
  lowStockThreshold: number; imageUrl: string; attributes: AttributeRow[]; isActive: boolean;
};
type Image = { url: string; alt: string; kind: "IMAGE" | "VIDEO" };
type Spec = { name: string; value: string };

const emptyVariant = (uiKey: string): Variant => ({ uiKey, name: "Default", sku: "", price: "", stock: "0", lowStockThreshold: 5, imageUrl: "", attributes: [], isActive: true });

// Textareas normalize CR and CRLF to LF in their DOM value. Match unchanged
// characters across the edit so their original line endings survive, even
// when a single paste changes text on both sides of a newline.
function mergeTextareaValue(original: string, edited: string) {
  if (!original.includes("\r")) return edited;
  let normalized = "";
  const boundaries = [0];
  for (let index = 0; index < original.length; index++) {
    if (original[index] === "\r") {
      if (original[index + 1] === "\n") index++;
      normalized += "\n";
    } else {
      normalized += original[index];
    }
    boundaries.push(index + 1);
  }
  // Matching line breaks is more important than matching surrounding letters:
  // a paste may replace both sides while leaving the visible newline unchanged.
  const newlineWeight = normalized.length + edited.length + 1;
  const scores = Array.from({ length: normalized.length + 1 }, () => new Uint32Array(edited.length + 1));
  for (let i = normalized.length - 1; i >= 0; i--) {
    for (let j = edited.length - 1; j >= 0; j--) {
      const match = normalized[i] === edited[j]
        ? scores[i + 1][j + 1] + (normalized[i] === "\n" ? newlineWeight : 1)
        : 0;
      scores[i][j] = Math.max(scores[i + 1][j], scores[i][j + 1], match);
    }
  }
  let i = 0;
  let j = 0;
  let merged = "";
  while (i < normalized.length && j < edited.length) {
    const match = normalized[i] === edited[j]
      ? scores[i + 1][j + 1] + (normalized[i] === "\n" ? newlineWeight : 1)
      : -1;
    if (scores[i][j] === match) {
      merged += original.slice(boundaries[i], boundaries[i + 1]);
      i++;
      j++;
    } else if (scores[i + 1][j] >= scores[i][j + 1]) {
      i++;
    } else {
      merged += edited[j++];
    }
  }
  return merged + edited.slice(j);
}

export function ProductForm({ product, categories }: {
  product?: {
    id: string; name: string; slug: string; sku: string | null; shortDescription: string | null;
    description: string | null; regularPrice: number; salePrice: number | null; categoryId: string | null;
    status: string; isFeatured: boolean; videoUrl: string | null; weightGrams: number | null;
    attributes: string[]; specifications: unknown;
    images: Array<{ url: string; alt: string | null; kind: string }>;
    variants: Array<{ id: string; name: string; sku: string | null; price: number | null; stock: number; lowStockThreshold: number; imageUrl: string | null; attributes: VariantAttribute[]; expectedAttributes: unknown; expectedMovementCount: number; updatedAt: Date | string; isActive: boolean }>;
  };
  categories: Array<{ id: string; name: string; isActive?: boolean }>;
}) {
  const nextUiKey = useRef(0);
  // Variant edits are serialized into hidden JSON. Do not allow pre-hydration
  // edits/submission to silently save the server-rendered default instead.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [variants, setVariants] = useState<Variant[]>(() => product?.variants.map((v) => ({
    uiKey: `existing-${v.id}`, id: v.id, name: v.name, sku: v.sku ?? "", price: v.price == null ? "" : String(v.price), stock: String(v.stock),
    expectedStock: v.stock, expectedMovementCount: v.expectedMovementCount,
    expectedUpdatedAt: new Date(v.updatedAt).toISOString(), expectedAttributes: v.expectedAttributes,
    lowStockThreshold: v.lowStockThreshold, imageUrl: v.imageUrl ?? "",
    attributes: v.attributes.map((attribute, index) => ({ ...attribute, uiKey: `initial-${index}` })), isActive: v.isActive,
  })) ?? [emptyVariant("initial-new")]);
  const [images, setImages] = useState<Image[]>(product?.images.map((i) => ({ url: i.url, alt: i.alt ?? "", kind: i.kind === "VIDEO" ? "VIDEO" : "IMAGE" })) ?? []);
  const [specs, setSpecs] = useState<Spec[]>((product?.specifications as Spec[] | undefined) ?? []);
  const [attributes, setAttributes] = useState<string[]>(product?.attributes ?? []);

  function localKey() {
    return `local-${nextUiKey.current++}`;
  }

  function updateVariant(key: string, patch: Partial<Variant>) {
    setVariants((current) => current.map((v) => (v.uiKey === key ? { ...v, ...patch } : v)));
  }

  function addVariant() {
    const uiKey = localKey();
    setVariants((current) => [...current, emptyVariant(uiKey)]);
  }

  function addAttribute(variantKey: string) {
    const uiKey = localKey();
    setVariants((current) => current.map((v) => v.uiKey === variantKey && v.attributes.length < 10
      ? { ...v, attributes: [...v.attributes, { uiKey, name: "", value: "" }] }
      : v));
  }

  function updateAttribute(variantKey: string, attributeKey: string, field: "name" | "value", edited: string) {
    setVariants((current) => current.map((v) => v.uiKey === variantKey
      ? { ...v, attributes: v.attributes.map((attribute) => attribute.uiKey === attributeKey
        ? { ...attribute, [field]: mergeTextareaValue(attribute[field], edited) }
        : attribute) }
      : v));
  }

  function removeAttribute(variantKey: string, attributeKey: string) {
    setVariants((current) => current.map((v) => v.uiKey === variantKey
      ? { ...v, attributes: v.attributes.filter((attribute) => attribute.uiKey !== attributeKey) }
      : v));
  }

  return (
    <form action={saveProductAction} aria-busy={!ready} className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <fieldset disabled={!ready} className="contents">
      <input type="hidden" name="id" value={product?.id ?? ""} />
      {product && <><input type="hidden" name="expectedCategoryId" value={product.categoryId ?? ""} /><input type="hidden" name="expectedStatus" value={product.status} /></>}
      <input type="hidden" name="variants" value={JSON.stringify(variants.map((v) => ({
        ...(v.id ? { id: v.id, expectedStock: v.expectedStock, expectedMovementCount: v.expectedMovementCount,
          expectedUpdatedAt: v.expectedUpdatedAt, expectedAttributes: v.expectedAttributes } : {}),
        name: v.name, sku: v.sku || null,
        price: v.price === "" ? null : Number(v.price), stock: v.stock === "" ? null : Number(v.stock),
        lowStockThreshold: Number(v.lowStockThreshold), imageUrl: v.imageUrl || null,
        attributes: v.attributes.map(({ name, value }) => ({ name, value })), isActive: v.isActive, position: 0,
      })))} />
      <input type="hidden" name="images" value={JSON.stringify(images.filter((i) => i.url))} />
      <input type="hidden" name="specifications" value={JSON.stringify(specs)} />
      <input type="hidden" name="attributes" value={JSON.stringify(attributes)} />

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="font-semibold">Basic information</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Product name" name="name" required><input id="name" className="input" name="name" defaultValue={product?.name} required /></Field>
            <Field label="URL slug" name="slug" hint="Lowercase letters, numbers and hyphens"><input className="input" name="slug" defaultValue={product?.slug} placeholder="auto-generated" /></Field>
            <Field label="SKU" name="sku"><input className="input" name="sku" defaultValue={product?.sku ?? ""} /></Field>
            <Field label="Category" name="categoryId"><select id="categoryId" className="input" name="categoryId" defaultValue={product?.categoryId ?? ""}><option value="">Uncategorised</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive === false ? " (inactive — current)" : ""}</option>)}{product?.categoryId && !categories.some((c) => c.id === product.categoryId) && <option value={product.categoryId}>Current category (unavailable)</option>}</select></Field>
          </div>
          <div className="mt-4"><Field label="Short description" name="shortDescription"><textarea className="textarea" name="shortDescription" defaultValue={product?.shortDescription ?? ""} /></Field></div>
          <div className="mt-4"><Field label="Full description" name="description"><textarea className="textarea min-h-[160px]" name="description" defaultValue={product?.description ?? ""} /></Field></div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Variants & stock</h2><button type="button" className="btn-secondary" onClick={addVariant}><Plus size={16} />Add variant</button></div>
          <p className="mt-1 text-xs text-ink-500">Each variant has its own price, SKU, stock and attributes. Existing variants can be deactivated to preserve order and inventory history.</p>
          <div className="mt-4 space-y-4">
            {variants.map((variant, index) => <div key={variant.uiKey} className="rounded-xl border border-ink-100 bg-ink-50/40 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Variant name" name={`v-name-${index}`}><input id={`v-name-${index}`} className="input" value={variant.name} onChange={(e) => updateVariant(variant.uiKey, { name: e.target.value })} required /></Field>
                <Field label="SKU" name={`v-sku-${index}`}><input className="input" value={variant.sku} onChange={(e) => updateVariant(variant.uiKey, { sku: e.target.value })} /></Field>
                <Field label="Price (BDT)" name={`v-price-${index}`} hint="Blank uses product price"><input className="input" type="number" min={0} value={variant.price} onChange={(e) => updateVariant(variant.uiKey, { price: e.target.value })} /></Field>
                <Field label="Stock" name={`v-stock-${index}`}><input className="input" type="number" min={0} max={2147483647} step={1} value={variant.stock} onChange={(e) => updateVariant(variant.uiKey, { stock: e.target.value })} required /></Field>
                <Field label="Low stock alert at" name={`v-threshold-${index}`}><input className="input" type="number" min={0} value={variant.lowStockThreshold} onChange={(e) => updateVariant(variant.uiKey, { lowStockThreshold: Number(e.target.value) })} /></Field>
                <Field label="Variant image URL" name={`v-image-${index}`}><input className="input" value={variant.imageUrl} onChange={(e) => updateVariant(variant.uiKey, { imageUrl: e.target.value })} /></Field>
                <fieldset className="rounded-lg border border-ink-100 p-3 sm:col-span-2 lg:col-span-4" aria-label={`Attributes for ${variant.name}`}>
                  <legend className="px-1 text-xs font-semibold text-ink-600">Attributes</legend>
                  <p className="mb-3 text-xs text-ink-500">Names and values are saved exactly as entered.</p>
                  <div className="space-y-3">
                    {variant.attributes.map((attribute, attributeIndex) => {
                      const prefix = `v-${variant.uiKey}-attribute-${attribute.uiKey}`;
                      return <div key={attribute.uiKey} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                        <Field label="Attribute name" name={`${prefix}-name`} required><textarea id={`${prefix}-name`} className="textarea min-h-[42px] resize-y" rows={1} maxLength={80} value={attribute.name} onChange={(e) => updateAttribute(variant.uiKey, attribute.uiKey, "name", e.target.value)} required /></Field>
                        <Field label="Attribute value" name={`${prefix}-value`}><textarea id={`${prefix}-value`} className="textarea min-h-[42px] resize-y" rows={1} maxLength={120} value={attribute.value} onChange={(e) => updateAttribute(variant.uiKey, attribute.uiKey, "value", e.target.value)} /></Field>
                        <button type="button" className="btn-ghost text-red-600" aria-label={`Remove attribute ${attributeIndex + 1} from ${variant.name}`} onClick={() => removeAttribute(variant.uiKey, attribute.uiKey)}><Trash2 size={16} />Remove</button>
                      </div>;
                    })}
                  </div>
                  <button type="button" className="btn-secondary mt-3" aria-label={`Add attribute to ${variant.name}`} disabled={variant.attributes.length >= 10} onClick={() => addAttribute(variant.uiKey)}><Plus size={16} />Add attribute</button>
                </fieldset>
              </div>
              <div className="mt-3 flex items-center justify-between"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={variant.isActive} onChange={(e) => updateVariant(variant.uiKey, { isActive: e.target.checked })} />Active</label>{!variant.id && variants.length > 1 && <button type="button" className="text-xs font-semibold text-red-600" aria-label={`Remove new variant ${variant.name}`} onClick={() => setVariants((current) => current.filter((v) => v.uiKey !== variant.uiKey))}><Trash2 size={14} className="inline" /> Remove</button>}</div>
            </div>)}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Images & video</h2><button type="button" className="btn-secondary" onClick={() => setImages((i) => [...i, { url: "", alt: "", kind: "IMAGE" }])}><Plus size={16} />Add image</button></div>
          <div className="mt-4 space-y-3">{images.map((image, index) => <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]"><input className="input" placeholder="Image URL" value={image.url} onChange={(e) => setImages((list) => list.map((i, n) => n === index ? { ...i, url: e.target.value } : i))} /><input className="input" placeholder="Alt text" value={image.alt} onChange={(e) => setImages((list) => list.map((i, n) => n === index ? { ...i, alt: e.target.value } : i))} /><button type="button" className="btn-ghost" onClick={() => setImages((list) => list.filter((_, n) => n !== index))}><Trash2 size={16} /></button></div>)}</div>
          <div className="mt-4"><Field label="Product video URL (YouTube/Vimeo watch URL)" name="videoUrl"><input className="input" name="videoUrl" defaultValue={product?.videoUrl ?? ""} /></Field></div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Specifications</h2><button type="button" className="btn-secondary" onClick={() => setSpecs((s) => [...s, { name: "", value: "" }])}><Plus size={16} />Add row</button></div>
          <div className="mt-4 space-y-3">{specs.map((spec, index) => <div key={index} className="grid gap-3 sm:grid-cols-2"><input className="input" placeholder="Label" value={spec.name} onChange={(e) => setSpecs((s) => s.map((item, n) => n === index ? { ...item, name: e.target.value } : item))} /><input className="input" placeholder="Value" value={spec.value} onChange={(e) => setSpecs((s) => s.map((item, n) => n === index ? { ...item, value: e.target.value } : item))} /></div>)}</div>
          <div className="mt-4"><Field label="Attribute names (comma separated)" name="attributes-list"><input className="input" defaultValue={attributes.join(", ")} onChange={(e) => setAttributes(e.target.value.split(",").map((a) => a.trim()).filter(Boolean))} /></Field></div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="font-semibold">Pricing & visibility</h2>
          <div className="mt-4 space-y-4">
            <Field label="Regular price (BDT)" name="regularPrice" required><input id="regularPrice" className="input" type="number" min={0} name="regularPrice" defaultValue={product?.regularPrice ?? 0} required /></Field>
            <Field label="Sale price (BDT)" name="salePrice" hint="Leave blank for no sale"><input className="input" type="number" min={0} name="salePrice" defaultValue={product?.salePrice ?? ""} /></Field>
            <Field label="Weight (grams)" name="weightGrams"><input className="input" type="number" min={0} name="weightGrams" defaultValue={product?.weightGrams ?? ""} /></Field>
            <Field label="Status" name="status"><select className="input" name="status" defaultValue={product?.status ?? "DRAFT"}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFeatured" defaultChecked={product?.isFeatured} />Feature this product</label>
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Save</h2>
          <p className="mt-2 text-xs text-ink-500">Publishing a product makes it orderable. Its landing page remains independently draft or published.</p>
          <div className="mt-4 space-y-2"><Button className="w-full">{product ? "Save changes" : "Create product"}</Button><Link href="/dashboard/products" className="btn-secondary w-full">Cancel</Link></div>
        </Card>
      </div>
      </fieldset>
      {!ready && <p className="text-sm text-ink-500">Loading product editor…</p>}
    </form>
  );
}
