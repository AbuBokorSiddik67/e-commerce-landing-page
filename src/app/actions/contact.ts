"use server";
import { z } from "zod";
import { emailSchema, nameSchema } from "@/lib/validation";
import { notifyOwners } from "@/lib/notifications";

const schema = z.object({
  name: nameSchema, email: emailSchema, subject: z.string().trim().min(3).max(160), message: z.string().trim().min(10).max(4000),
});

export async function contactAction(_state: { error?: string; ok?: boolean } | undefined, formData: FormData) {
  const parsed = schema.safeParse({
    name: formData.get("name"), email: formData.get("email"),
    subject: formData.get("subject"), message: formData.get("message"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form" };
  await notifyOwners("CONTACT_MESSAGE", `Contact: ${parsed.data.subject}`, `${parsed.data.name} <${parsed.data.email}>: ${parsed.data.message}`);
  return { ok: true };
}
