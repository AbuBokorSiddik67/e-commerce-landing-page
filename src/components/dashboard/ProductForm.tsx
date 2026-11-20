"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { saveProductAction } from "@/app/actions/products";
import { Button, Card, Field } from "@/components/ui";
import type { VariantAttribute } from "@/lib/product-attributes";

type Variant = {
  id?: string; name: string; sku: string; price: string; stock: number;
  lowStockThreshold: number; imageUrl: string; attributes: VariantAttribute[]; attributesText: string; isActive: boolean;
};
type Image = { url: string; alt: string; kind: "IMAGE" | "VIDEO" };
type Spec = { name: string; value: string };

const emptyVariant = (): Variant => ({ name: "Default", sku: "", price: "", stock: 0, lowStockThreshold: 5, imageUrl: "", attributes: [], attributesText: "", isActive: true });

function parseAttributesText(text: string): VariantAttribute[] {
  return text.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...value] = part.split(":");
    return { name: name.trim(), value: value.join(":").trim() };
  });
}

export function ProductForm({ product, categories }: {
  product?: {
    id: string; name: string; slug: string; sku: string | null; shortDescription: string | null;
    description: string | null; regularPrice: number; salePrice: number | null; categoryId: string | null;
    status: string; isFeatured: boolean; videoUrl: string | null; weightGrams: number | null;
    attributes: string[]; specifications: unknown;
    images: Array<{ url: string; alt: string | null; kind: string }>;
    variants: Array<{ id: string; name: string; sku: string | null; price: number | null; stock: number; lowStockThreshold: number; imageUrl: string | null; attributes: VariantAttribute[]; isActive: boolean }>;
  };
  categories: Array<{ id: string; name: string }>;
}) {
  const [variants, setVariants] = useState<Variant[]>(product?.variants.map((v) => ({
    id: v.id, name: v.name, sku: v.sku ?? "", price: v.price == null ? "" : String(v.price), stock: v.stock,
    lowStockThreshold: v.lowStockThreshold, imageUrl: v.imageUrl ?? "", attributes: v.attributes,
    attributesText: v.attributes.map((a) => `${a.name}: ${a.value}`).join(", "), isActive: v.isActive,
  })) ?? [emptyVariant()]);
  const [images, setImages] = useState<Image[]>(product?.images.map((i) => ({ url: i.url, alt: i.alt ?? "", kind: i.kind === "VIDEO" ? "VIDEO" : "IMAGE" })) ?? []);
  const [specs, setSpecs] = useState<Spec[]>((product?.specifications as Spec[] | undefined) ?? []);
  const [attributes, setAttributes] = useState<string[]>(product?.attributes ?? []);

  function updateVariant(index: number, patch: Partial<Variant>) {
    setVariants((current) => current.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  return (
    <form action={saveProductAction} className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <input type="hidden" name="id" value={product?.id ?? ""} />
      <input type="hidden" name="variants" value={JSON.stringify(variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}), name: v.name, sku: v.sku || null,
        price: v.price === "" ? null : Number(v.price), stock: Number(v.stock),
        lowStockThreshold: Number(v.lowStockThreshold), imageUrl: v.imageUrl || null,
        attributes: v.attributes, isActive: v.isActive, position: 0,
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
            <Field label="Category" name="categoryId"><select className="input" name="categoryId" defaultValue={product?.categoryId ?? ""}><option value="">Uncategorised</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </div>
          <div className="mt-4"><Field label="Short description" name="shortDescription"><textarea className="textarea" name="shortDescription" defaultValue={product?.shortDescription ?? ""} /></Field></div>
          <div className="mt-4"><Field label="Full description" name="description"><textarea className="textarea min-h-[160px]" name="description" defaultValue={product?.description ?? ""} /></Field></div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Variants & stock</h2><button type="button" className="btn-secondary" onClick={() => setVariants((v) => [...v, emptyVariant()])}><Plus size={16} />Add variant</button></div>
          <p className="mt-1 text-xs text-ink-500">Each variant has its own price, SKU, stock and attributes (e.g. Size: M, Color: Black).</p>
          <div className="mt-4 space-y-4">
            {variants.map((variant, index) => <div key={variant.id ?? `new-${index}`} className="rounded-xl border border-ink-100 bg-ink-50/40 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Variant name" name={`v-name-${index}`}><input id={`v-name-${index}`} className="input" value={variant.name} onChange={(e) => updateVariant(index, { name: e.target.value })} required /></Field>
                <Field label="SKU" name={`v-sku-${index}`}><input className="input" value={variant.sku} onChange={(e) => updateVariant(index, { sku: e.target.value })} /></Field>
                <Field label="Price (BDT)" name={`v-price-${index}`} hint="Blank uses product price"><input className="input" type="number" min={0} value={variant.price} onChange={(e) => updateVariant(index, { price: e.target.value })} /></Field>
                <Field label="Stock" name={`v-stock-${index}`}><input className="input" type="number" min={0} value={variant.stock} onChange={(e) => updateVariant(index, { stock: Number(e.target.value) })} /></Field>
                <Field label="Low stock alert at" name={`v-threshold-${index}`}><input className="input" type="number" min={0} value={variant.lowStockThreshold} onChange={(e) => updateVariant(index, { lowStockThreshold: Number(e.target.value) })} /></Field>
                <Field label="Variant image URL" name={`v-image-${index}`}><input className="input" value={variant.imageUrl} onChange={(e) => updateVariant(index, { imageUrl: e.target.value })} /></Field>
                <div className="sm:col-span-2"><Field label="Attributes" name={`v-attrs-${index}`} hint="Comma-separated, e.g. Size: M, Color: Black"><input id={`v-attrs-${index}`} className="input" value={variant.attributesText} onChange={(e) => updateVariant(index, { attributesText: e.target.value, attributes: parseAttributesText(e.target.value) })} /></Field></div>
              </div>
              <div className="mt-3 flex items-center justify-between"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={variant.isActive} onChange={(e) => updateVariant(index, { isActive: e.target.checked })} />Active</label>{variants.length > 1 && <button type="button" className="text-xs font-semibold text-red-600" onClick={() => setVariants((v) => v.filter((_, i) => i !== index))}><Trash2 size={14} className="inline" /> Remove</button>}</div>
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
    </form>
  );
}
