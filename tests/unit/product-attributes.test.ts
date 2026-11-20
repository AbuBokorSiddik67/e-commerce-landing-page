import { describe, expect, it } from "vitest";
import { normalizeStoredVariantAttributes, StoredVariantAttributesError, variantAttributesSchema } from "@/lib/product-attributes";

const context = { productName: "Cotton Shirt", variantName: "Medium" };

function normalize(input: unknown) {
  return normalizeStoredVariantAttributes(input, context);
}

describe("stored variant attributes", () => {
  it("accepts canonical arrays without changing names, values, or order", () => {
    const input = Object.freeze([
      Object.freeze({ name: " Size ", value: "M, tall" }),
      Object.freeze({ name: "Color", value: "Blue: dark" }),
    ]);
    expect(normalize(input)).toEqual(input);
    expect(input).toEqual([{ name: " Size ", value: "M, tall" }, { name: "Color", value: "Blue: dark" }]);
  });

  it("converts legacy string maps without modifying their names or values", () => {
    const input = Object.freeze({ Size: "M", Color: "Black", " Finish ": " matte, soft " });
    expect(normalize(input)).toEqual([
      { name: "Size", value: "M" }, { name: "Color", value: "Black" }, { name: " Finish ", value: " matte, soft " },
    ]);
    expect(input).toEqual({ Size: "M", Color: "Black", " Finish ": " matte, soft " });
  });

  it("treats both empty arrays and empty legacy objects as no attributes", () => {
    expect(normalize([])).toEqual([]);
    expect(normalize({})).toEqual([]);
  });

  it("accepts the existing schema limits, including empty values", () => {
    const input = Array.from({ length: 10 }, (_, index) => ({
      name: `${index}${"n".repeat(79)}`, value: index === 0 ? "" : "v".repeat(120),
    }));
    expect(normalize(input)).toEqual(input);
  });

  it("preserves JSON object keys that have special JavaScript names", () => {
    const input: unknown = JSON.parse('{"__proto__":"safe","constructor":"also safe"}');
    expect(normalize(input)).toEqual([{ name: "__proto__", value: "safe" }, { name: "constructor", value: "also safe" }]);
  });

  it.each([
    ["number", 42],
    ["null", null],
    ["undefined", undefined],
    ["boolean", false],
    ["string", "Size: M"],
    ["array containing a number", [42]],
    ["array containing null", [null]],
    ["array entry missing a value", [{ name: "Size" }]],
    ["array entry with a non-string value", [{ name: "Size", value: 42 }]],
    ["array entry with an unknown field", [{ name: "Size", value: "M", source: "do not discard" }]],
    ["legacy non-string value", { Size: 42 }],
    ["legacy null value", { Size: null }],
    ["legacy boolean value", { Size: true }],
    ["legacy array value", { Size: ["M"] }],
    ["legacy nested value", { Size: { value: "M" } }],
    ["empty legacy name", { "": "M" }],
    ["long legacy name", { ["x".repeat(81)]: "M" }],
    ["long legacy value", { Size: "x".repeat(121) }],
    ["empty name", [{ name: "", value: "M" }]],
    ["long name", [{ name: "x".repeat(81), value: "M" }]],
    ["long value", [{ name: "Size", value: "x".repeat(121) }]],
    ["too many array entries", Array.from({ length: 11 }, (_, index) => ({ name: `Size${index}`, value: "M" }))],
    ["too many legacy entries", Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`Size${index}`, "M"]))],
    ["ambiguous single attribute object", { name: "Size", value: "M" }],
    ["ambiguous missing-value singleton", { name: "Size" }],
    ["ambiguous missing-name singleton", { value: "M" }],
    ["ambiguous partial singleton with extra keys", { name: "Size", source: "do not reinterpret" }],
    ["ambiguous value key with another legacy key", { Size: "M", value: "other" }],
    ["ambiguous object with extra keys", { name: "Size", value: "M", extra: "text" }],
    ["non-JSON object", new Date(0)],
  ])("rejects %s with product and variant context", (_label, input) => {
    expect(() => normalize(input)).toThrow(StoredVariantAttributesError);
    expect(() => normalize(input)).toThrow(/Cotton Shirt/);
    expect(() => normalize(input)).toThrow(/Medium/);
  });

  it("does not reveal raw values in a contextual error", () => {
    try {
      normalize([{ name: "Size", value: "M", privateMetadata: "do-not-display" }]);
      throw new Error("Expected invalid stored attributes");
    } catch (error) {
      expect(error).toBeInstanceOf(StoredVariantAttributesError);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("unsupported fields");
      expect(error.message).not.toContain("do-not-display");
    }
  });
});

describe("new variant attribute submissions", () => {
  it("accepts canonical arrays but rejects legacy objects and extra fields", () => {
    expect(variantAttributesSchema.parse([{ name: "Size", value: "M" }])).toEqual([{ name: "Size", value: "M" }]);
    expect(variantAttributesSchema.safeParse({ Size: "M" }).success).toBe(false);
    expect(variantAttributesSchema.safeParse([{ name: "Size", value: "M", extra: "do not discard" }]).success).toBe(false);
  });
});
