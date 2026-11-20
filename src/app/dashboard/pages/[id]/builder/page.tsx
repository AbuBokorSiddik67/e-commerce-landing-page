import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageBuilder } from "@/components/dashboard/PageBuilder";
import { Alert, PageHeader } from "@/components/ui";
import type { SectionData, SectionType } from "@/lib/page-sections";
import { normalizePageSeo, normalizePageSettings, pageSettingsSchema, seoSchema } from "@/lib/page-config";

export default async function BuilderPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }>;
}) {
  await requirePageAccess(PERMISSIONS.PAGE_VIEW);
  const { id } = await params;
  const query = await searchParams;
  const [page, templates] = await Promise.all([
    prisma.landingPage.findUnique({ where: { id }, include: { product: { include: { images: { orderBy: { position: "asc" }, take: 1 } } }, sections: { orderBy: { position: "asc" } } } }),
    prisma.landingPageTemplate.findMany({ where: { isActive: true }, select: { code: true, name: true, category: true }, orderBy: { name: "asc" } }),
  ]);
  if (!page) notFound();
  return (
    <>
      <PageHeader title={`Builder · ${page.title}`} description="Add, edit, reorder and preview sections. Save a draft or publish when ready." action={<a href={`/p/${page.slug}`} target="_blank" className="btn-secondary">View live page</a>} />
      <Alert error={query.error} success={query.success} />
      <PageBuilder
        page={{
          id: page.id, slug: page.slug, title: page.title, status: page.status, templateCode: page.templateCode,
          theme: (page.theme ?? {}) as Record<string, string>,
          seo: seoSchema.parse(normalizePageSeo(page.seo)),
          settings: pageSettingsSchema.parse(normalizePageSettings(page.settings)), noIndex: page.noIndex,
          scheduledFor: page.scheduledFor?.toISOString() ?? null,
          product: { name: page.product.name, slug: page.product.slug, regularPrice: page.product.regularPrice, salePrice: page.product.salePrice, images: page.product.images.map((i) => ({ url: i.url, alt: i.alt })) },
        }}
        sections={page.sections.map((section) => ({
          id: section.id, type: section.type as SectionType, data: section.data as SectionData, enabled: section.enabled, position: section.position,
        }))}
        templates={templates}
      />
    </>
  );
}
