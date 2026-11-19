import { notFound, permanentRedirect, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function LegacyPath({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const from = `/${path.join("/")}`;
  const rule = await prisma.redirect.findUnique({ where: { fromPath: from } });
  if (!rule || !rule.isActive) notFound();
  if (rule.permanent) permanentRedirect(rule.toPath);
  redirect(rule.toPath);
}
