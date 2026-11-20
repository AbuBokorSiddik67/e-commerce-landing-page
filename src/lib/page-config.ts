import { z } from "zod";
import { normalizeBooleanLiteral } from "@/lib/form-boolean";

export const seoSchema = z.object({
  title: z.string().max(180).optional(),
  description: z.string().max(400).optional(),
  canonical: z.string().max(500).optional(),
  ogImage: z.string().max(500).optional(),
  noIndex: z.boolean().optional(),
}).default({});

export const pageSettingsSchema = z.object({
  whatsappNumber: z.string().max(30).optional(),
  showStickyCta: z.boolean().optional(),
  showRelatedProducts: z.boolean().optional(),
  primaryCtaText: z.string().max(80).optional(),
}).default({});

export type PageSeo = z.output<typeof seoSchema>;
export type PageSettings = z.output<typeof pageSettingsSchema>;

/** Convert only recognised form literals; all other values still reach Zod unchanged. */
function normalizeBooleanFields(value: unknown, fields: readonly string[]): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const result: Record<string, unknown> = { ...value };
  for (const field of fields) {
    if (Object.hasOwn(result, field)) result[field] = normalizeBooleanLiteral(result[field]);
  }
  return result;
}

// Shared by the action and the builder's database read, including older form data.
export function normalizePageSeo(value: unknown): unknown {
  return normalizeBooleanFields(value, ["noIndex"]);
}

export function normalizePageSettings(value: unknown): unknown {
  return normalizeBooleanFields(value, ["showStickyCta", "showRelatedProducts"]);
}
