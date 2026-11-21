import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { slugSchema } from "@/lib/validation";
import { SECTION_TYPES, SECTION_DEFAULTS, sectionsFromTemplate, sectionDataSchema } from "@/lib/page-sections";
import { pageSettingsSchema, seoSchema } from "@/lib/page-config";

const sectionSchema = z.object({
  id: z.string().optional(),
  type: z.enum(SECTION_TYPES),
  data: sectionDataSchema,
  enabled: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
});

export const pageSchema = z.object({
  title: z.string().trim().min(2).max(200),
  slug: slugSchema,
  templateCode: z.string().max(60).default("general"),
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]).default("DRAFT"),
  scheduledFor: z.string().datetime().optional().nullable(),
  theme: z.record(z.string(), z.string()).default({}),
  seo: seoSchema,
  analytics: z.record(z.string(), z.string()).default({}),
  settings: pageSettingsSchema,
  noIndex: z.boolean().default(false),
  sections: z.array(sectionSchema).default([]),
});

export type PageInput = z.input<typeof pageSchema>;

async function ensureSlug(slug: string, excludeId?: string) {
  const existing = await prisma.landingPage.findUnique({ where: { slug } });
  if (existing && existing.id !== excludeId) throw new ConflictError("This slug is already in use");
  return slug;
}

async function snapshot(pageId: string, actorId?: string, note?: string) {
  const page = await prisma.landingPage.findUniqueOrThrow({ where: { id: pageId }, include: { sections: { orderBy: { position: "asc" } } } });
  const last = await prisma.pageVersion.findFirst({ where: { pageId }, orderBy: { version: "desc" } });
  await prisma.pageVersion.create({
    data: {
      pageId, version: (last?.version ?? 0) + 1, note: note ?? null,
      snapshot: { ...page, sections: page.sections } as never,
      // createdById isn't on PageVersion; actor is captured in the audit log instead.
    },
  });
  void actorId;
}

export async function createLandingPage(productId: string, input: PageInput, actorId?: string) {
  const data = pageSchema.parse(input);
  await ensureSlug(data.slug);
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new NotFoundError("Product not found");
  const existing = await prisma.landingPage.findUnique({ where: { productId } });
  if (existing) throw new ConflictError("This product already has a landing page");
  const sections = data.sections.length
    ? data.sections
    : sectionsFromTemplate(data.templateCode).map((section, position) => ({ ...section, position }));
  const publishedAt = data.status === "PUBLISHED" ? new Date() : null;
  const page = await prisma.$transaction(async (tx) => {
    const created = await tx.landingPage.create({
      data: {
        productId, slug: data.slug, title: data.title, status: data.status,
        templateCode: data.templateCode, theme: data.theme as never, seo: data.seo as never,
        analytics: data.analytics as never, settings: data.settings as never,
        noIndex: data.noIndex, publishedAt,
        scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
        createdById: actorId ?? null,
        sections: { create: sections.map((s) => ({ type: s.type, data: s.data as never, enabled: s.enabled, position: s.position })) },
      },
      include: { sections: true },
    });
    await tx.pageVersion.create({
      data: { pageId: created.id, version: 1, note: "Initial version", snapshot: { ...created } as never },
    });
    return created;
  });
  await audit({ actorId, action: "CREATE_LANDING_PAGE", entity: "LandingPage", entityId: page.id, after: { id: page.id, slug: page.slug } });
  return page;
}

export async function updateLandingPage(id: string, input: PageInput, actorId?: string, createVersion = true) {
  const data = pageSchema.parse(input);
  await ensureSlug(data.slug, id);
  const existing = await prisma.landingPage.findUnique({ where: { id }, include: { sections: true } });
  if (!existing) throw new NotFoundError("Landing page not found");
  const page = await prisma.$transaction(async (tx) => {
    const updated = await tx.landingPage.update({
      where: { id },
      data: {
        slug: data.slug, title: data.title, templateCode: data.templateCode, status: data.status,
        scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
        theme: data.theme as never, seo: data.seo as never, analytics: data.analytics as never,
        settings: data.settings as never, noIndex: data.noIndex,
        publishedAt: data.status === "PUBLISHED" ? (existing.publishedAt ?? new Date()) : null,
      },
    });
    const keepIds = data.sections.filter((s) => s.id).map((s) => s.id as string);
    await tx.landingPageSection.deleteMany({ where: { pageId: id, id: { notIn: keepIds } } });
    for (const section of data.sections) {
      const values = { type: section.type, data: section.data as never, enabled: section.enabled, position: section.position };
      if (section.id && keepIds.includes(section.id)) {
        await tx.landingPageSection.update({ where: { id: section.id }, data: values });
      } else {
        await tx.landingPageSection.create({ data: { pageId: id, ...values } });
      }
    }
    return updated;
  });
  if (createVersion) await snapshot(id, actorId, "Editor save");
  await audit({ actorId, action: "UPDATE_LANDING_PAGE", entity: "LandingPage", entityId: id, before: { slug: existing.slug, status: existing.status }, after: { slug: page.slug, status: page.status } });
  return page;
}

export async function publishLandingPage(id: string, actorId?: string, publish = true) {
  const page = await prisma.landingPage.update({
    where: { id },
    data: { status: publish ? "PUBLISHED" : "DRAFT", publishedAt: publish ? new Date() : null },
  });
  await snapshot(id, actorId, publish ? "Published" : "Unpublished");
  await audit({ actorId, action: publish ? "PUBLISH_PAGE" : "UNPUBLISH_PAGE", entity: "LandingPage", entityId: id });
  return page;
}

/** Called before rendering a draft/scheduled page. */
export async function processScheduledPages() {
  const due = await prisma.landingPage.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
  });
  for (const page of due) {
    await prisma.landingPage.update({
      where: { id: page.id }, data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }
  return due.length;
}

export async function listPages(options: { search?: string; page?: number; perPage?: number } = {}) {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, options.perPage ?? 20);
  const where = options.search ? { OR: [
    { title: { contains: options.search, mode: "insensitive" as const } },
    { slug: { contains: options.search, mode: "insensitive" as const } },
  ] } : {};
  const [items, total] = await Promise.all([
    prisma.landingPage.findMany({ where, include: { product: { select: { id: true, name: true, slug: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * perPage, take: perPage }),
    prisma.landingPage.count({ where }),
  ]);
  return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
}

export async function applyTemplate(pageId: string, templateCode: string, actorId?: string) {
  const page = await prisma.landingPage.findUniqueOrThrow({ where: { id: pageId } });
  const sections = sectionsFromTemplate(templateCode);
  const template = await prisma.landingPageTemplate.findUnique({ where: { code: templateCode } });
  await prisma.$transaction(async (tx) => {
    await tx.landingPageSection.deleteMany({ where: { pageId } });
    await tx.landingPageSection.createMany({
      data: sections.map((section, position) => ({
        pageId, type: section.type, data: section.data as never, enabled: section.enabled, position,
      })),
    });
    await tx.landingPage.update({ where: { id: pageId }, data: { templateCode, theme: (template?.theme ?? {}) as never } });
  });
  await snapshot(pageId, actorId, `Applied template ${templateCode}`);
  void page;
}

export async function getTemplateSections(type: string) {
  return { ...SECTION_DEFAULTS[type as keyof typeof SECTION_DEFAULTS] };
}
