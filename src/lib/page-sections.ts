import { z } from "zod";

export const SECTION_TYPES = [
  "announcement", "header", "hero", "problem_solution", "benefits", "features",
  "gallery", "video", "specifications", "variants", "pricing", "offers",
  "comparison", "testimonials", "reviews", "faq", "delivery", "trust",
  "cta", "order_form", "related_products", "footer",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_LABELS: Record<SectionType, string> = {
  announcement: "Announcement Bar",
  header: "Header",
  hero: "Hero Section",
  problem_solution: "Problem & Solution",
  benefits: "Benefits",
  features: "Features",
  gallery: "Product Gallery",
  video: "Product Video",
  specifications: "Specifications",
  variants: "Variants",
  pricing: "Pricing",
  offers: "Offers",
  comparison: "Comparison",
  testimonials: "Testimonials",
  reviews: "Reviews",
  faq: "FAQ",
  delivery: "Delivery Information",
  trust: "Trust Section",
  cta: "CTA",
  order_form: "Order Form",
  related_products: "Related Products",
  footer: "Footer",
};

export const listSchema = z.array(z.object({ title: z.string(), body: z.string() }));
export const linkListSchema = z.array(z.object({ label: z.string(), url: z.string() }));

/** Structured section content: text, numbers, images and arrays only. No HTML or scripts. */
export const sectionDataSchema = z.object({
  eyebrow: z.string().max(160).optional(),
  title: z.string().max(300).optional(),
  subtitle: z.string().max(1200).optional(),
  body: z.string().max(5000).optional(),
  buttonText: z.string().max(80).optional(),
  buttonUrl: z.string().max(300).optional(),
  image: z.string().max(500).optional(),
  imageAlt: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  items: z.array(z.object({
    title: z.string().max(200).optional(),
    body: z.string().max(1000).optional(),
    label: z.string().max(120).optional(),
    value: z.string().max(300).optional(),
    image: z.string().max(500).optional(),
    url: z.string().max(300).optional(),
  })).max(30).optional(),
  columns: z.number().int().min(1).max(4).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
}).strict();

export type SectionData = z.infer<typeof sectionDataSchema>;

export const SECTION_DEFAULTS: Record<SectionType, SectionData> = {
  announcement: { body: "Free delivery on orders above ৳1,500 · Cash on Delivery available" },
  header: { title: "Your Brand", items: [{ label: "Features", url: "#features" }, { label: "Order", url: "#order" }] },
  hero: {
    eyebrow: "Introducing", title: "A better way to shop",
    subtitle: "Tell customers what makes this product worth choosing, in one clear sentence.",
    buttonText: "Order Now", buttonUrl: "#order", image: "", imageAlt: "Product photo",
  },
  problem_solution: {
    title: "The problem, solved",
    items: [
      { title: "The challenge", body: "Describe the frustration your customer faces today." },
      { title: "Our solution", body: "Explain how your product fixes it." },
    ],
  },
  benefits: {
    title: "Why you'll love it",
    items: [
      { title: "Built to last", body: "A real benefit written in plain language." },
      { title: "Easy to use", body: "Another specific, verifiable benefit." },
      { title: "Great value", body: "Explain the value without invented claims." },
    ],
    columns: 3,
  },
  features: {
    title: "What's included",
    items: [
      { title: "Feature one", body: "Describe a concrete feature." },
      { title: "Feature two", body: "Describe another concrete feature." },
    ],
    columns: 2,
  },
  gallery: { title: "See it from every angle", items: [], columns: 3 },
  video: { title: "Watch it in action", body: "Paste a YouTube or Vimeo watch URL in the page settings." },
  specifications: { title: "Specifications", items: [{ label: "Brand", value: "Your brand" }] },
  variants: { title: "Available options", body: "Choose your preferred option below." },
  pricing: { title: "Simple, transparent pricing", body: "No hidden charges. Pay when your order arrives." },
  offers: { title: "Current offer", body: "Describe any genuine, currently available offer." },
  comparison: {
    title: "How it compares",
    items: [
      { title: "Our product", body: "A verifiable advantage." },
      { title: "Typical alternative", body: "An honest point of comparison." },
    ],
  },
  testimonials: { title: "What customers say", body: "Only publish testimonials you have actually received." },
  reviews: { title: "Verified reviews", body: "Reviews appear here once approved by the store owner." },
  faq: {
    title: "Frequently asked questions",
    items: [
      { title: "How do I order?", body: "Choose your options, fill in the order form and confirm by phone." },
      { title: "How long does delivery take?", body: "Delivery times depend on your location." },
    ],
  },
  delivery: {
    title: "Delivery information",
    body: "We deliver across Bangladesh. Delivery charges are calculated at checkout.",
  },
  trust: {
    title: "Shop with confidence",
    items: [
      { title: "Cash on Delivery", body: "Pay in cash when your order arrives." },
      { title: "Order tracking", body: "Track your order with a private link." },
    ],
  },
  cta: { title: "Ready to order?", subtitle: "Join satisfied customers today.", buttonText: "Order Now", buttonUrl: "#order" },
  order_form: { title: "Place your order", body: "Fill in your details and we will contact you to confirm." },
  related_products: { title: "You may also like", body: "More products from this store." },
  footer: { title: "Your Brand", body: "© 2026 Your Brand. All rights reserved.", items: [] },
};

export type TemplateDefinition = {
  code: string;
  name: string;
  category: string;
  description: string;
  previewColor: string;
  theme: Record<string, string>;
  sections: { type: SectionType; data: Partial<SectionData> }[];
};

const base = (extra: Partial<SectionData> = {}): { type: SectionType; data: Partial<SectionData> }[] => [
  { type: "announcement", data: {} },
  { type: "header", data: {} },
  { type: "hero", data: { buttonText: "Order Now" } },
  { type: "benefits", data: {} },
  { type: "gallery", data: {} },
  { type: "pricing", data: {} },
  { type: "delivery", data: {} },
  { type: "trust", data: {} },
  { type: "faq", data: {} },
  { type: "order_form", data: {} },
  { type: "footer", data: {} },
];

export const TEMPLATES: TemplateDefinition[] = [
  {
    code: "fashion", name: "Fashion Storefront", category: "Fashion", previewColor: "#8b5cf6",
    description: "Editorial hero, lookbook gallery and size-aware order form.",
    theme: { primary: "#7c3aed", accent: "#f5d0fe", surface: "#ffffff", text: "#1f1635", radius: "18px" },
    sections: [
      { type: "announcement", data: { body: "New season collection · Cash on Delivery available" } },
      { type: "header", data: {} }, { type: "hero", data: { eyebrow: "New collection" } },
      { type: "benefits", data: { title: "Made for everyday comfort" } },
      { type: "gallery", data: { title: "The lookbook" } },
      { type: "variants", data: {} }, { type: "pricing", data: {} },
      { type: "testimonials", data: {} }, { type: "delivery", data: {} },
      { type: "order_form", data: {} }, { type: "footer", data: {} },
    ],
  },
  {
    code: "electronics", name: "Tech Launch", category: "Electronics", previewColor: "#2563eb",
    description: "Specification-led layout built for gadgets and devices.",
    theme: { primary: "#1d4ed8", accent: "#dbeafe", surface: "#ffffff", text: "#0f172a", radius: "10px" },
    sections: [
      { type: "announcement", data: {} }, { type: "header", data: {} },
      { type: "hero", data: { eyebrow: "Now available" } }, { type: "features", data: {} },
      { type: "specifications", data: {} }, { type: "comparison", data: {} },
      { type: "gallery", data: {} }, { type: "pricing", data: {} },
      { type: "delivery", data: {} }, { type: "trust", data: {} },
      { type: "order_form", data: {} }, { type: "footer", data: {} },
    ],
  },
  {
    code: "beauty", name: "Beauty Edit", category: "Beauty", previewColor: "#db2777",
    description: "Soft, product-first design for beauty and personal care.",
    theme: { primary: "#be185d", accent: "#fce7f3", surface: "#fffafc", text: "#3f2431", radius: "22px" },
    sections: base().map((s) => (s.type === "benefits" ? { ...s, data: { title: "Why customers choose it" } } : s)),
  },
  {
    code: "home", name: "Home & Living", category: "Home and Lifestyle", previewColor: "#b45309",
    description: "Warm lifestyle layout with problem/solution storytelling.",
    theme: { primary: "#92400e", accent: "#fef3c7", surface: "#fffdf8", text: "#292524", radius: "14px" },
    sections: [
      { type: "announcement", data: {} }, { type: "header", data: {} }, { type: "hero", data: {} },
      { type: "problem_solution", data: {} }, { type: "gallery", data: {} }, { type: "benefits", data: {} },
      { type: "offers", data: {} }, { type: "pricing", data: {} }, { type: "delivery", data: {} },
      { type: "order_form", data: {} }, { type: "footer", data: {} },
    ],
  },
  {
    code: "gadgets", name: "Gadget Spotlight", category: "Gadgets", previewColor: "#0891b2",
    description: "Compact conversion layout with video and trust blocks.",
    theme: { primary: "#0e7490", accent: "#cffafe", surface: "#ffffff", text: "#083344", radius: "12px" },
    sections: [
      { type: "announcement", data: {} }, { type: "header", data: {} }, { type: "hero", data: {} },
      { type: "video", data: {} }, { type: "features", data: {} }, { type: "gallery", data: {} },
      { type: "specifications", data: {} }, { type: "reviews", data: {} }, { type: "pricing", data: {} },
      { type: "trust", data: {} }, { type: "order_form", data: {} }, { type: "footer", data: {} },
    ],
  },
  {
    code: "general", name: "General Product", category: "General Products", previewColor: "#206a53",
    description: "Balanced starter template suitable for any product.",
    theme: { primary: "#206a53", accent: "#d7ede3", surface: "#ffffff", text: "#1b2230", radius: "14px" },
    sections: base(),
  },
];

export function sectionsFromTemplate(code: string) {
  const template = TEMPLATES.find((t) => t.code === code) ?? TEMPLATES[TEMPLATES.length - 1];
  return template.sections.map((section, index) => ({
    type: section.type,
    data: { ...SECTION_DEFAULTS[section.type], ...section.data },
    enabled: true,
    position: index,
  }));
}
