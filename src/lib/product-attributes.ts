import { z } from "zod";

/** Canonical representation for a variant's attributes, including JSON storage. */
export const attributeSchema = z.object({
  name: z.string().min(1).max(80),
  value: z.string().max(120),
});

export const variantAttributesSchema = z.array(attributeSchema).max(10);
export type VariantAttribute = z.infer<typeof attributeSchema>;
