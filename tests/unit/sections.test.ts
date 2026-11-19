import { describe, expect, it } from "vitest";
import { SECTION_TYPES, sectionDataSchema, sectionsFromTemplate, TEMPLATES } from "@/lib/page-sections";

describe("landing page sections", () => {
  it("provides all 22 section types and six templates", () => {
    expect(SECTION_TYPES).toHaveLength(22);
    expect(TEMPLATES).toHaveLength(6);
    for (const template of TEMPLATES) {
      const sections = sectionsFromTemplate(template.code);
      expect(sections.length).toBeGreaterThan(5);
      expect(sections.every((s) => SECTION_TYPES.includes(s.type))).toBe(true);
    }
  });

  it("rejects arbitrary scripts and unknown keys in section data", () => {
    const result = sectionDataSchema.safeParse({ title: "Hello", onload: "alert(1)" });
    expect(result.success).toBe(false);
    expect(sectionDataSchema.safeParse({ title: "Hello", items: [{ title: "A", body: "B" }] }).success).toBe(true);
  });
});
