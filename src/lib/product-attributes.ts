import { z } from "zod";

/** Canonical representation for a variant's attributes, including JSON storage. */
export const attributeSchema = z.object({
  name: z.string().min(1).max(80),
  value: z.string().max(120),
});

// Unknown entry fields must not be silently stripped on a read or a later save.
export const variantAttributesSchema = z.array(attributeSchema.strict()).max(10);
export type VariantAttribute = z.infer<typeof attributeSchema>;

type VariantContext = { productName: string; variantName: string };

/** Safe to show in the dashboard: no raw attribute values or database IDs. */
export class StoredVariantAttributesError extends Error {
  constructor({ productName, variantName }: VariantContext, reason: string) {
    super(`Cannot safely load attributes for variant "${variantName}" of product "${productName}". ${reason} Please contact a store administrator.`);
    this.name = "StoredVariantAttributesError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Interpret stored JSON only. Product submissions must use variantAttributesSchema
 * directly, so legacy objects are never accepted as new input.
 */
export function normalizeStoredVariantAttributes(input: unknown, context: VariantContext): VariantAttribute[] {
  let candidate: unknown = input;

  if (isPlainObject(input)) {
    // Even a partial singleton can also be a legacy map. Without provenance,
    // either reserved key is ambiguous, including maps with additional fields.
    if (Object.hasOwn(input, "name") || Object.hasOwn(input, "value")) {
      throw new StoredVariantAttributesError(context, "The saved attribute format is ambiguous.");
    }
    const entries = Object.entries(input);
    if (entries.some(([, value]) => typeof value !== "string")) {
      throw new StoredVariantAttributesError(context, "Saved legacy attribute values must be text.");
    }
    candidate = entries.map(([name, value]) => ({ name, value }));
  } else if (!Array.isArray(input)) {
    throw new StoredVariantAttributesError(context, "The saved attribute format is unsupported.");
  }

  const result = variantAttributesSchema.safeParse(candidate);
  if (!result.success) {
    const hasUnknownFields = result.error.issues.some((issue) => issue.code === "unrecognized_keys");
    throw new StoredVariantAttributesError(
      context,
      hasUnknownFields
        ? "An attribute contains unsupported fields."
        : "An attribute is invalid or exceeds the supported limits.",
    );
  }
  return result.data;
}
