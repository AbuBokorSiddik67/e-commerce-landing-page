import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { siteUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await prisma.landingPage.findMany({
    where: { status: "PUBLISHED", noIndex: false, product: { status: "PUBLISHED" } },
    select: { slug: true, updatedAt: true },
  });
  const staticRoutes = ["", "/features", "/how-it-works", "/demo", "/purchase", "/docs", "/contact", "/privacy", "/terms"].map((path) => ({
    url: `${siteUrl()}${path}`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: path === "" ? 1 : 0.5,
  }));
  return [
    ...staticRoutes,
    ...pages.map((page) => ({
      url: `${siteUrl()}/p/${page.slug}`,
      lastModified: page.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
