"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { applyTemplate, createLandingPage, publishLandingPage, updateLandingPage, type PageInput } from "@/services/pages";
import { bool, finish, jsonField, optionalStr, str } from "./helpers";

type PagePayload = PageInput;

function payload(formData: FormData): PagePayload {
  return {
    title: str(formData, "title"), slug: slugify(str(formData, "slug")),
    templateCode: str(formData, "templateCode", "general"),
    status: str(formData, "status", "DRAFT") as PagePayload["status"],
    scheduledFor: optionalStr(formData, "scheduledFor"),
    theme: jsonField(formData, "theme", {}),
    seo: jsonField(formData, "seo", {}),
    analytics: jsonField(formData, "analytics", {}),
    settings: jsonField(formData, "settings", {}),
    noIndex: bool(formData, "noIndex"),
    sections: jsonField(formData, "sections", []) as PageInput["sections"],
  };
}

export async function createPageAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.PAGE_WRITE);
  await finish("/dashboard/pages", () => createLandingPage(str(formData, "productId"), {
    ...payload(formData), sections: [],
  }, user.id), "Landing page created");
}

export async function savePageAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.PAGE_WRITE);
  const id = str(formData, "id");
  await finish(`/dashboard/pages/${id}/builder`, async () => {
    await updateLandingPage(id, payload(formData), user.id);
    revalidatePath(`/p/${str(formData, "slug")}`);
  }, "Draft saved");
}

export async function publishPageAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.PAGE_PUBLISH);
  const id = str(formData, "id");
  await finish(`/dashboard/pages/${id}/builder`, async () => {
    await publishLandingPage(id, user.id, bool(formData, "publish"));
    revalidatePath("/");
  }, bool(formData, "publish") ? "Page published" : "Page unpublished");
}

export async function applyTemplateAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.TEMPLATE_WRITE);
  const id = str(formData, "id");
  await finish(`/dashboard/pages/${id}/builder`, () => applyTemplate(id, str(formData, "templateCode"), user.id), "Template applied — review and save");
}

export async function createRedirectAction(formData: FormData) {
  await requirePermission(PERMISSIONS.SETTINGS_WRITE);
  await finish("/dashboard/settings", async () => {
    const from = str(formData, "fromPath");
    if (!from.startsWith("/") || !str(formData, "toPath").startsWith("/")) throw new Error("Paths must start with /");
    await prisma.redirect.upsert({
      where: { fromPath: from },
      create: { fromPath: from, toPath: str(formData, "toPath"), permanent: bool(formData, "permanent"), isActive: true },
      update: { toPath: str(formData, "toPath"), permanent: bool(formData, "permanent"), isActive: true },
    });
  }, "Redirect saved");
}

export async function deleteRedirectAction(formData: FormData) {
  await requirePermission(PERMISSIONS.SETTINGS_WRITE);
  await finish("/dashboard/settings", () => prisma.redirect.delete({ where: { id: str(formData, "id") } }), "Redirect deleted");
}
