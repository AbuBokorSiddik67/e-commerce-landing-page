import type { ReactNode } from "react";
import type { SectionData, SectionType } from "@/lib/page-sections";
import { formatMoney } from "@/lib/utils";

export type RenderSection = {
  id: string;
  type: SectionType;
  data: SectionData;
  enabled: boolean;
  position: number;
};

export type RenderProduct = {
  name: string;
  slug: string;
  regularPrice: number;
  salePrice: number | null;
  shortDescription?: string | null;
  description?: string | null;
  images: { url: string; alt?: string | null }[];
};

type Props = {
  sections: RenderSection[];
  theme: Record<string, string>;
  product: RenderProduct;
  businessName: string;
  whatsappNumber?: string;
  checkout?: ReactNode;
  reviews?: { customerName: string; rating: number; title: string | null; body: string; verifiedPurchase: boolean }[];
  related?: RenderProduct[];
  preview?: boolean;
};

function Heading({ eyebrow, title, subtitle, align = "center" }: { eyebrow?: string; title?: string; subtitle?: string; align?: "left" | "center" | "right" }) {
  return (
    <div className={`mb-8 ${align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"}`}>
      {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--lp-primary)" }}>{eyebrow}</p>}
      {title && <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>}
      {subtitle && <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-ink-500">{subtitle}</p>}
    </div>
  );
}

function Items({ items, columns = 3, numbered = false }: { items?: SectionData["items"]; columns?: number; numbered?: boolean }) {
  if (!items?.length) return <p className="text-center text-sm text-ink-400">No items configured yet.</p>;
  return <div className="grid gap-4 sm:grid-cols-2" style={{ gridTemplateColumns: columns === 1 || columns === 2 || columns === 3 || columns === 4 ? undefined : undefined }}>
    {items.map((item, index) => (
      <div key={`${item.title ?? item.label ?? "item"}-${index}`} className="rounded-2xl border border-ink-100 bg-white p-5">
        {numbered && <span className="mb-3 grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white" style={{ background: "var(--lp-primary)" }}>{index + 1}</span>}
        {item.label && <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{item.label}</p>}
        {item.value && <p className="mt-1 font-semibold">{item.value}</p>}
        {item.title && <h3 className="font-semibold">{item.title}</h3>}
        {item.body && <p className="mt-2 text-sm leading-relaxed text-ink-600">{item.body}</p>}
        {item.image && <img src={item.image} alt={item.title ?? ""} loading="lazy" className="mt-3 h-40 w-full rounded-xl object-cover" />}
      </div>
    ))}
  </div>;
}

function CtaLink({ text, url }: { text?: string; url?: string }) {
  if (!text) return null;
  const href = url?.startsWith("#") || url?.startsWith("/") ? url : "#order";
  return <a href={href} className="btn-primary mt-6 inline-flex" style={{ background: "var(--lp-primary)" }}>{text}</a>;
}

function sectionContent(section: RenderSection, ctx: Omit<Props, "sections" | "theme">) {
  const { data, type } = section;
  const price = ctx.product.salePrice ?? ctx.product.regularPrice;
  switch (type) {
    case "announcement":
      return <div className="px-5 py-2.5 text-center text-xs font-medium text-white" style={{ background: "var(--lp-primary)" }}>{data.body}</div>;
    case "header":
      return <header className="border-b border-ink-100 bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><span className="text-lg font-semibold tracking-tight" style={{ color: "var(--lp-primary)" }}>{data.title ?? ctx.businessName}</span><div className="flex flex-wrap gap-4 text-sm text-ink-600">{(data.items ?? []).map((item, i) => <a key={i} href={item.url || "#"} className="hover:underline">{item.label}</a>)}<a href="#order" className="font-semibold" style={{ color: "var(--lp-primary)" }}>Order now</a></div></div></header>;
    case "hero":
      return <section className="bg-white"><div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-2"><div><Heading eyebrow={data.eyebrow} title={data.title ?? ctx.product.name} subtitle={data.subtitle ?? ctx.product.shortDescription ?? undefined} align="left" /><div className="flex flex-wrap items-center gap-4"><CtaLink text={data.buttonText ?? "Order Now"} url={data.buttonUrl} /><span className="text-sm text-ink-500">{formatMoney(price)} · Cash on Delivery</span></div></div>{data.image ? <img src={data.image} alt={data.imageAlt ?? ctx.product.name} className="w-full rounded-3xl object-cover shadow-soft" /> : ctx.product.images[0] ? <img src={ctx.product.images[0].url} alt={ctx.product.images[0].alt ?? ctx.product.name} className="w-full rounded-3xl object-cover shadow-soft" /> : <div className="grid h-80 place-items-center rounded-3xl text-sm text-ink-400" style={{ background: "var(--lp-accent)" }}>Product image</div>}</div></section>;
    case "problem_solution":
    case "benefits":
    case "features":
    case "comparison":
    case "trust":
      return <section className="px-5 py-14"><div className="mx-auto max-w-6xl"><Heading {...data} /><div className={type === "benefits" || type === "features" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-4 md:grid-cols-2"}><Items items={data.items} columns={data.columns ?? 3} numbered={type === "problem_solution"} /></div></div></section>;
    case "gallery":
      return <section className="bg-white px-5 py-14"><div className="mx-auto max-w-6xl"><Heading {...data} /><div className="grid gap-3 sm:grid-cols-3">{(data.items?.length ? data.items.map((i) => i.image).filter(Boolean) as string[] : ctx.product.images.map((i) => i.url)).map((url, i) => <img key={i} src={url} alt={`${ctx.product.name} ${i + 1}`} loading="lazy" className="h-64 w-full rounded-2xl object-cover" />)}</div></div></section>;
    case "video":
      return <section className="px-5 py-14"><div className="mx-auto max-w-3xl text-center"><Heading {...data} />{data.body && <p className="text-sm text-ink-600">{data.body}</p>}<div className="mt-6 aspect-video rounded-2xl bg-ink-900 text-sm text-ink-400 grid place-items-center">Video embed configured by the store owner</div></div></section>;
    case "specifications":
      return <section className="bg-white px-5 py-14"><div className="mx-auto max-w-3xl"><Heading {...data} /><dl className="divide-y divide-ink-100 rounded-2xl border border-ink-100">{data.items?.map((item, i) => <div key={i} className="flex justify-between gap-6 px-5 py-3 text-sm"><dt className="text-ink-500">{item.label}</dt><dd className="font-medium">{item.value}</dd></div>)}</dl></div></section>;
    case "variants":
      return <section className="px-5 py-14"><div className="mx-auto max-w-3xl text-center"><Heading {...data} /><p className="text-sm text-ink-600">Available options are shown in the order form below.</p></div></section>;
    case "pricing":
    case "offers":
      return <section className="px-5 py-14" style={{ background: "var(--lp-accent)" }}><div className="mx-auto max-w-2xl text-center"><Heading eyebrow={data.eyebrow} title={data.title ?? "Pricing"} subtitle={data.subtitle ?? data.body} /><div className="rounded-3xl bg-white p-8 shadow-card"><p className="text-sm text-ink-500">{ctx.product.name}</p><p className="mt-2 text-4xl font-semibold" style={{ color: "var(--lp-primary)" }}>{formatMoney(price)}</p>{ctx.product.salePrice && <p className="mt-1 text-sm text-ink-400 line-through">{formatMoney(ctx.product.regularPrice)}</p>}<p className="mt-4 text-xs text-ink-500">Delivery charge is shown before confirmation.</p><CtaLink text="Order Now" url="#order" /></div></div></section>;
    case "testimonials":
    case "reviews": {
      const items = ctx.reviews ?? [];
      return <section className="bg-white px-5 py-14"><div className="mx-auto max-w-4xl"><Heading {...data} />{items.length ? <div className="grid gap-4 sm:grid-cols-2">{items.map((review) => <div key={`${review.customerName}-${review.title}`} className="rounded-2xl border border-ink-100 p-5"><p className="text-sm text-amber-500">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</p><h3 className="mt-2 font-semibold">{review.title || "Customer review"}</h3><p className="mt-2 text-sm text-ink-600">{review.body}</p><p className="mt-3 text-xs text-ink-400">{review.customerName}{review.verifiedPurchase ? " · Verified purchase" : ""}</p></div>)}</div> : <p className="text-center text-sm text-ink-400">{data.body ?? "No published reviews yet."}</p>}</div></section>;
    }
    case "faq":
      return <section className="px-5 py-14"><div className="mx-auto max-w-3xl"><Heading {...data} /><div className="space-y-3">{data.items?.map((item, i) => <details key={i} className="group rounded-xl border border-ink-100 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">{item.title}</summary><p className="mt-2 text-sm text-ink-600">{item.body}</p></details>)}</div></div></section>;
    case "delivery":
      return <section className="bg-white px-5 py-12"><div className="mx-auto max-w-3xl text-center"><Heading {...data} /></div></section>;
    case "cta":
      return <section className="px-5 py-16 text-center text-white" style={{ background: "var(--lp-primary)" }}><div className="mx-auto max-w-2xl"><h2 className="text-3xl font-semibold">{data.title}</h2>{data.subtitle && <p className="mt-3 text-white/80">{data.subtitle}</p>}<a href={data.buttonUrl?.startsWith("#") ? data.buttonUrl : "#order"} className="btn mt-6 bg-white" style={{ color: "var(--lp-primary)" }}>{data.buttonText ?? "Order Now"}</a></div></section>;
    case "order_form":
      return <section id="order" className="bg-white px-5 py-16"><div className="mx-auto max-w-4xl"><Heading {...data} />{ctx.checkout ?? <div className="rounded-2xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">Order form preview — available on the published page.</div>}</div></section>;
    case "related_products":
      return <section className="px-5 py-14"><div className="mx-auto max-w-6xl"><Heading {...data} /><div className="grid gap-4 sm:grid-cols-3">{(ctx.related ?? []).map((item) => <a key={item.slug} href={`/p/${item.slug}`} className="rounded-2xl border border-ink-100 bg-white p-5"><h3 className="font-semibold">{item.name}</h3><p className="mt-2 text-sm" style={{ color: "var(--lp-primary)" }}>{formatMoney(item.salePrice ?? item.regularPrice)}</p></a>)}{!ctx.related?.length && <p className="text-sm text-ink-400">No related products yet.</p>}</div></div></section>;
    case "footer":
      return <footer className="bg-ink-950 px-5 py-10 text-center text-sm text-ink-300"><p className="font-semibold text-white">{data.title ?? ctx.businessName}</p><p className="mt-2">{data.body}</p>{(data.items ?? []).map((item, i) => <a key={i} href={item.url || "#"} className="mx-2 text-xs hover:text-white">{item.label}</a>)}</footer>;
    default:
      return null;
  }
}

export function SectionRenderer({ sections, theme, ...ctx }: Props) {
  const themeStyle = {
    "--lp-primary": theme.primary ?? "#206a53",
    "--lp-accent": theme.accent ?? "#eef7f3",
    "--lp-surface": theme.surface ?? "#ffffff",
    "--lp-radius": theme.radius ?? "14px",
    color: theme.text ?? "#1b2230",
    background: theme.surface ?? "#ffffff",
  } as React.CSSProperties;
  return (
    <div style={themeStyle} className="min-h-screen">
      {sections.filter((s) => s.enabled).sort((a, b) => a.position - b.position).map((section) => (
        <div key={section.id} data-section={section.type}>{sectionContent(section, ctx)}</div>
      ))}
      {ctx.whatsappNumber && (
        <a
          href={`https://wa.me/${ctx.whatsappNumber.replace(/[^0-9]/g, "")}`}
          target="_blank" rel="noopener noreferrer"
          className="fixed bottom-5 right-5 z-50 rounded-full bg-green-600 px-5 py-3 text-sm font-semibold text-white shadow-lg"
          aria-label="Contact on WhatsApp"
        >
          WhatsApp
        </a>
      )}
    </div>
  );
}
