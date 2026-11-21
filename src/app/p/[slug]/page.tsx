import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { siteUrl } from "@/lib/config";
import { processScheduledPages } from "@/services/pages";
import { approvedReviews } from "@/services/reviews";
import { getCheckoutPaymentMethods, getBusinessSettings } from "@/lib/settings";
import { getPublicIntegrations } from "@/lib/marketing";
import { SectionRenderer, type RenderSection } from "@/components/public/SectionRenderer";
import { CheckoutForm } from "@/components/public/CheckoutForm";
import { MarketingEvents } from "@/components/public/MarketingEvents";
import type { SectionData } from "@/lib/page-sections";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ cartVariant?: string; cartQuantity?: string }> };

async function getPage(slug: string) {
  await processScheduledPages();
  return prisma.landingPage.findFirst({
    where: { slug, status: "PUBLISHED", product: { status: "PUBLISHED" } },
    include: {
      product: { include: { variants: { where: { isActive: true }, orderBy: { position: "asc" } }, images: { orderBy: { position: "asc" } } } },
      sections: { where: { enabled: true }, orderBy: { position: "asc" } },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: "Page not found", robots: { index: false } };
  const seo = page.seo as { title?: string; description?: string; canonical?: string; ogImage?: string; noIndex?: boolean };
  const title = seo.title || page.title;
  const description = seo.description || page.product.shortDescription || "Order online with Cash on Delivery.";
  const image = seo.ogImage || page.product.images[0]?.url;
  const canonical = seo.canonical || `${siteUrl()}/p/${page.slug}`;
  const noIndex = page.noIndex || seo.noIndex === true;
  return {
    title,
    description,
    alternates: { canonical },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: { title, description, url: canonical, images: image ? [image] : [], type: "website" },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : [] },
  };
}

export default async function PublicLandingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const cart = searchParams ? await searchParams : {};
  const page = await getPage(slug);
  if (!page) notFound();
  const [business, methods, reviews, integrations, related] = await Promise.all([
    getBusinessSettings(),
    getCheckoutPaymentMethods(),
    approvedReviews(page.productId),
    getPublicIntegrations(),
    prisma.product.findMany({
      where: { status: "PUBLISHED", id: { not: page.productId }, landingPage: { is: { status: "PUBLISHED" } } },
      select: { name: true, slug: true, regularPrice: true, salePrice: true, landingPage: { select: { slug: true } }, images: { take: 1, orderBy: { position: "asc" } } },
      take: 3,
    }),
  ]);

  const sections: RenderSection[] = page.sections.map((section) => ({
    id: section.id,
    type: section.type as RenderSection["type"],
    data: section.data as SectionData,
    enabled: section.enabled,
    position: section.position,
  }));
  const settings = page.settings as { whatsappNumber?: string; showRelatedProducts?: boolean };
  const theme = page.theme as Record<string, string>;
  const checkout = <CheckoutForm productId={page.product.id} productName={page.product.name} productSlug={page.slug} regularPrice={page.product.regularPrice} salePrice={page.product.salePrice} variants={page.product.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, stock: v.stock, sku: v.sku }))} methods={methods} initialVariantId={cart.cartVariant} initialQuantity={Number(cart.cartQuantity)} />;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product", name: page.product.name,
        description: page.product.shortDescription ?? page.product.description ?? "",
        image: page.product.images.map((i) => i.url),
        sku: page.product.sku ?? undefined,
        offers: {
          "@type": "Offer", price: page.product.salePrice ?? page.product.regularPrice,
          priceCurrency: business.currency,
          availability: page.product.variants.some((v) => v.stock > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          url: `${siteUrl()}/p/${page.slug}`,
        },
        ...(reviews.length ? { aggregateRating: { "@type": "AggregateRating", ratingValue: (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1), reviewCount: reviews.length } } : {}),
      },
      { "@type": "Organization", name: business.name, email: business.email ?? undefined, telephone: business.phone ?? undefined, url: siteUrl(), logo: business.logoUrl ?? undefined },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl() },
        { "@type": "ListItem", position: 2, name: page.product.name, item: `${siteUrl()}/p/${page.slug}` },
      ] },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <MarketingEvents pageId={page.id} productId={page.productId} metaPixelId={integrations.metaPixelId} gaId={integrations.googleAnalyticsId} gtmId={integrations.gtmId} />
      <nav aria-label="Store navigation" className="container-wide flex justify-end gap-5 py-4 text-sm font-semibold text-brand-700"><Link href="/shop">Browse products</Link><Link href="/cart">Cart</Link></nav>
      {sections.length > 0 && <SectionRenderer
        sections={sections}
        theme={theme}
        product={{
          name: page.product.name, slug: page.product.slug, regularPrice: page.product.regularPrice,
          salePrice: page.product.salePrice, shortDescription: page.product.shortDescription,
          description: page.product.description, images: page.product.images.map((i) => ({ url: i.url, alt: i.alt })),
        }}
        businessName={business.name}
        whatsappNumber={settings.whatsappNumber}
        checkout={checkout}
        reviews={reviews}
        related={settings.showRelatedProducts === false ? [] : related.map((item) => ({ name: item.name, slug: item.landingPage?.slug ?? item.slug, regularPrice: item.regularPrice, salePrice: item.salePrice, images: item.images.map((i) => ({ url: i.url, alt: null })) }))}
      />}
      {!sections.some((section) => section.type === "order_form") && <section id="order" className="container-wide max-w-4xl py-12">
        <h1 className="mb-3 text-2xl font-semibold">{page.product.name}</h1>
        {(page.product.shortDescription || page.product.description) && <p className="mb-6 text-sm text-ink-600">{page.product.shortDescription || page.product.description}</p>}
        {checkout}
      </section>}
    </>
  );
}
