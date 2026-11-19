"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Save, Trash2 } from "lucide-react";
import { applyTemplateAction, publishPageAction, savePageAction } from "@/app/actions/pages";
import { Button, Card, Field } from "@/components/ui";
import { SectionRenderer, type RenderSection } from "@/components/public/SectionRenderer";
import { SECTION_DEFAULTS, SECTION_LABELS, SECTION_TYPES, type SectionData, type SectionType } from "@/lib/page-sections";

type PageData = {
  id: string; slug: string; title: string; status: string; templateCode: string;
  theme: Record<string, string>; seo: Record<string, unknown>; settings: Record<string, unknown>;
  noIndex: boolean; scheduledFor: string | null;
  product: { name: string; slug: string; regularPrice: number; salePrice: number | null; images: Array<{ url: string; alt: string | null }> };
};

export function PageBuilder({ page, sections, templates }: {
  page: PageData; sections: RenderSection[]; templates: Array<{ code: string; name: string; category: string }>;
}) {
  const [items, setItems] = useState<RenderSection[]>(sections);
  const [selected, setSelected] = useState<string>(sections[0]?.id ?? "");
  const [preview, setPreview] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [theme, setTheme] = useState<Record<string, string>>(page.theme);
  const [seo, setSeo] = useState<Record<string, string>>({ ...page.seo as Record<string, string>, noIndex: String(page.noIndex || (page.seo as { noIndex?: boolean }).noIndex || false) });
  const [settings, setSettings] = useState<Record<string, string>>({
    whatsappNumber: "", showStickyCta: "true", showRelatedProducts: "true", primaryCtaText: "Order Now",
    ...(page.settings as Record<string, string>),
  });
  const current = items.find((s) => s.id === selected);

  function update(id: string, patch: Partial<RenderSection>) {
    setItems((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function updateData(patch: Partial<SectionData>) {
    if (!current) return;
    update(current.id, { data: { ...current.data, ...patch } });
  }
  function move(index: number, direction: -1 | 1) {
    const next = [...items];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next.map((s, i) => ({ ...s, position: i })));
  }
  function addSection(type: SectionType) {
    const id = `new-${Date.now()}`;
    setItems((list) => [...list, { id, type, data: SECTION_DEFAULTS[type], enabled: true, position: list.length }]);
    setSelected(id);
  }
  function duplicate(id: string) {
    const index = items.findIndex((s) => s.id === id);
    if (index < 0) return;
    const source = items[index];
    const copy = { ...source, id: `copy-${Date.now()}`, data: { ...source.data }, position: items.length };
    setItems((list) => [...list, copy]);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      <form action={savePageAction} id="page-form" className="contents">
        <input type="hidden" name="id" value={page.id} />
        <input type="hidden" name="title" value={page.title} />
        <input type="hidden" name="slug" value={page.slug} />
        <input type="hidden" name="templateCode" value={page.templateCode} />
        <input type="hidden" name="status" value={page.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT"} />
        <input type="hidden" name="scheduledFor" value={page.scheduledFor ?? ""} />
        <input type="hidden" name="theme" value={JSON.stringify(theme)} />
        <input type="hidden" name="seo" value={JSON.stringify(seo)} />
        <input type="hidden" name="settings" value={JSON.stringify(settings)} />
        <input type="hidden" name="analytics" value="{}" />
        <input type="hidden" name="noIndex" value={seo.noIndex === "true" ? "on" : ""} />
        <input type="hidden" name="sections" value={JSON.stringify(items)} />
      </form>

      <Card className="h-fit p-5">
        <h2 className="font-semibold">Page sections</h2>
        <p className="mt-1 text-xs text-ink-500">{items.length} blocks · click to edit</p>
        <div className="mt-4 max-h-[560px] space-y-1 overflow-y-auto pr-1">
          {items.map((section, index) => <div key={section.id} className={`flex items-center gap-1 rounded-lg border px-2 py-2 text-sm ${selected === section.id ? "border-brand-500 bg-brand-50" : "border-transparent hover:bg-ink-50"}`}>
            <button type="button" onClick={() => setSelected(section.id)} className="flex-1 truncate text-left">{SECTION_LABELS[section.type]}</button>
            {!section.enabled && <EyeOff size={14} className="text-ink-400" />}
            <button type="button" title="Move up" onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
            <button type="button" title="Move down" onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
          </div>)}
        </div>
        <div className="mt-4 border-t border-ink-100 pt-4">
          <label className="label">Add a section</label>
          <select className="input" defaultValue="" onChange={(e) => { if (e.target.value) addSection(e.target.value as SectionType); e.target.value = ""; }}><option value="">Choose a block…</option>{SECTION_TYPES.map((type) => <option key={type} value={type}>{SECTION_LABELS[type]}</option>)}</select>
        </div>
        <div className="mt-4 border-t border-ink-100 pt-4">
          <label className="label">Start from a template</label>
          <form action={applyTemplateAction} className="flex gap-2"><input type="hidden" name="id" value={page.id} /><select className="input" name="templateCode">{templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select><button className="btn-secondary px-3">Apply</button></form>
        </div>
        <div className="mt-4 space-y-2 border-t border-ink-100 pt-4">
          <Button form="page-form" className="w-full"><Save size={16} />Save draft</Button>
          <form action={publishPageAction} className="flex gap-2"><input type="hidden" name="id" value={page.id} /><input type="hidden" name="publish" value={page.status === "PUBLISHED" ? "false" : "true"} /><button className={page.status === "PUBLISHED" ? "btn-secondary flex-1" : "btn-primary flex-1"}>{page.status === "PUBLISHED" ? "Unpublish" : "Publish page"}</button></form>
        </div>
      </Card>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Visual editor</h2><p className="text-xs text-ink-500">Changes appear in the preview as you type. Save to persist.</p></div><div className="flex gap-1 rounded-lg bg-ink-100 p-1">{(["desktop", "tablet", "mobile"] as const).map((mode) => <button key={mode} onClick={() => setPreview(mode)} className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${preview === mode ? "bg-white shadow-sm" : "text-ink-500"}`}>{mode}</button>)}</div></div>
        <Card className="mb-5 p-5">
          {current ? <>
            <div className="flex items-center justify-between"><h3 className="font-semibold">{SECTION_LABELS[current.type]}</h3><div className="flex gap-1"><button onClick={() => update(current.id, { enabled: !current.enabled })} title="Enable/disable" className="btn-ghost p-2">{current.enabled ? <Eye size={16} /> : <EyeOff size={16} />}</button><button onClick={() => duplicate(current.id)} title="Duplicate" className="btn-ghost p-2"><Copy size={16} /></button><button onClick={() => { setItems((list) => list.filter((s) => s.id !== current.id)); setSelected(""); }} title="Delete" className="btn-ghost p-2 text-red-600"><Trash2 size={16} /></button></div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["eyebrow", "title", "subtitle", "body", "buttonText", "buttonUrl", "image", "imageAlt", "note"] as const).map((key) => (
                <div key={key} className={key === "body" || key === "subtitle" || key === "image" ? "sm:col-span-2" : ""}>
                  <Field label={key.replace(/([A-Z])/g, " $1")} name={`section-${key}`}><input className="input" value={String(current.data[key] ?? "")} onChange={(e) => updateData({ [key]: e.target.value })} /></Field>
                </div>
              ))}
              <Field label="Columns" name="columns"><input className="input" type="number" min={1} max={4} value={current.data.columns ?? 3} onChange={(e) => updateData({ columns: Number(e.target.value) })} /></Field>
              <Field label="Alignment" name="align"><select className="input" value={current.data.align ?? "center"} onChange={(e) => updateData({ align: e.target.value as "left" | "center" | "right" })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></Field>
            </div>
            <div className="mt-4 border-t border-ink-100 pt-4"><p className="mb-2 text-xs font-semibold uppercase text-ink-500">List items</p>{(current.data.items ?? []).map((item, index) => <div key={index} className="mb-2 grid gap-2 sm:grid-cols-2"><input className="input" placeholder="Title / label" value={item.title ?? item.label ?? ""} onChange={(e) => { const itemsList = [...(current.data.items ?? [])]; itemsList[index] = { ...itemsList[index], title: e.target.value }; updateData({ items: itemsList }); }} /><input className="input" placeholder="Body / value" value={item.body ?? item.value ?? ""} onChange={(e) => { const itemsList = [...(current.data.items ?? [])]; itemsList[index] = { ...itemsList[index], body: e.target.value }; updateData({ items: itemsList }); }} /></div>)}<button type="button" className="btn-secondary" onClick={() => updateData({ items: [...(current.data.items ?? []), { title: "New item", body: "Description" }] })}><Plus size={14} />Add item</button></div>
          </> : <p className="text-sm text-ink-500">Select a section to edit its content.</p>}
        </Card>
        <div className={`mx-auto overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card transition-all ${preview === "mobile" ? "max-w-[390px]" : preview === "tablet" ? "max-w-[760px]" : "max-w-full"}`}>
          <div className="border-b border-ink-100 bg-ink-50 px-4 py-2 text-center text-xs font-semibold text-ink-500">{preview} preview · {page.title}</div>
          <div className="pointer-events-none origin-top">
            <SectionRenderer sections={items} theme={theme} product={{ name: page.product.name, slug: page.product.slug, regularPrice: page.product.regularPrice, salePrice: page.product.salePrice, images: page.product.images }} businessName={page.product.name} preview />
          </div>
        </div>
      </div>

      <Card className="h-fit p-5">
        <h2 className="font-semibold">Design & SEO</h2>
        <p className="mt-1 text-xs text-ink-500">Colours apply to this page only. Global branding is in Business Settings.</p>
        <div className="mt-4 space-y-3">{(["primary", "accent", "surface", "text", "radius"] as const).map((key) => <Field key={key} label={key} name={`theme-${key}`}><input className="input" value={theme[key] ?? ""} onChange={(e) => setTheme((t) => ({ ...t, [key]: e.target.value }))} /></Field>)}</div>
        <div className="mt-5 border-t border-ink-100 pt-4"><h3 className="text-sm font-semibold">SEO</h3><div className="mt-3 space-y-3">{(["title", "description", "canonical", "ogImage"] as const).map((key) => <Field key={key} label={key} name={`seo-${key}`}><input className="input" value={seo[key] ?? ""} onChange={(e) => setSeo((s) => ({ ...s, [key]: e.target.value }))} /></Field>)}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={seo.noIndex === "true"} onChange={(e) => setSeo((s) => ({ ...s, noIndex: String(e.target.checked) }))} />Do not index this page</label></div></div>
        <div className="mt-5 border-t border-ink-100 pt-4"><h3 className="text-sm font-semibold">Page options</h3><div className="mt-3 space-y-3">{(["whatsappNumber", "showStickyCta", "showRelatedProducts", "primaryCtaText"] as const).map((key) => <Field key={key} label={key} name={`settings-${key}`}><input className="input" value={settings[key] ?? ""} onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))} /></Field>)}</div></div>
      </Card>
    </div>
  );
}
