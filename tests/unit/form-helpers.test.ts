import { describe, expect, it, vi } from "vitest";
import { bool, jsonField } from "@/app/actions/helpers";
import { normalizePageSeo, normalizePageSettings, pageSettingsSchema, seoSchema } from "@/lib/page-config";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("form parsing", () => {
  it("handles checked, explicitly false and omitted checkboxes", () => {
    const form = new FormData();
    expect(bool(form, "option")).toBe(false);
    for (const value of ["on", "true"]) {
      form.set("option", value);
      expect(bool(form, "option")).toBe(true);
    }
    for (const value of ["", "off", "false"]) {
      form.set("option", value);
      expect(bool(form, "option")).toBe(false);
    }
    form.set("option", "perhaps");
    expect(() => bool(form, "option")).toThrow("Invalid checkbox value for option");
  });

  it("uses defaults only for absent/empty JSON fields and rejects malformed JSON", () => {
    const form = new FormData();
    expect(jsonField(form, "settings", {})).toEqual({});
    form.set("settings", "  ");
    expect(jsonField(form, "settings", {})).toEqual({});
    form.set("settings", '{"showStickyCta":false}');
    expect(jsonField(form, "settings", {})).toEqual({ showStickyCta: false });
    form.set("settings", "{invalid");
    expect(() => jsonField(form, "settings", {})).toThrow("Invalid JSON for settings");
  });

  it("converts recognised nested literals without accepting unrelated values", () => {
    expect(seoSchema.parse(normalizePageSeo({ noIndex: "false" }))).toEqual({ noIndex: false });
    expect(pageSettingsSchema.parse(normalizePageSettings({ showStickyCta: "on", showRelatedProducts: "off" }))).toEqual({ showStickyCta: true, showRelatedProducts: false });
    expect(seoSchema.safeParse(normalizePageSeo({ noIndex: "sometimes" })).success).toBe(false);
    expect(pageSettingsSchema.safeParse(normalizePageSettings({ showStickyCta: 1 })).success).toBe(false);
    expect(seoSchema.safeParse({ noIndex: "true" }).success).toBe(false);
  });
});
