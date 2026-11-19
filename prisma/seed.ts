import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABELS } from "../src/lib/permissions";
import { TEMPLATES, SECTION_DEFAULTS, sectionsFromTemplate } from "../src/lib/page-sections";

const prisma = new PrismaClient();

async function main() {
  for (const permission of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission },
      create: { key: permission, group: permission.split(".")[0], description: permission.replaceAll(".", " ") },
      update: {},
    });
  }
  for (const [key, permissions] of Object.entries({ OWNER: ALL_PERMISSIONS, ...ROLE_PERMISSIONS })) {
    const role = await prisma.role.upsert({
      where: { key },
      create: { key, name: ROLE_LABELS[key] ?? key, isSystem: true },
      update: { name: ROLE_LABELS[key] ?? key, isSystem: true },
    });
    for (const permission of permissions) {
      const record = await prisma.permission.findUniqueOrThrow({ where: { key: permission } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: record.id } },
        create: { roleId: role.id, permissionId: record.id },
        update: {},
      });
    }
  }

  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? "owner@landiq.local").toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "Owner@123456789";
  const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!existingOwner) {
    const owner = await prisma.user.create({
      data: {
        name: "Store Owner", email: ownerEmail,
        passwordHash: await bcrypt.hash(ownerPassword, 12),
      },
    });
    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "OWNER" } });
    await prisma.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id } });
  }

  const business = await prisma.businessSetting.findFirst();
  if (!business) {
    await prisma.businessSetting.create({
      data: {
        name: "LANDIQ Store",
        description: "Quality products with dependable delivery across Bangladesh.",
        email: "hello@example.com", phone: "01700000000",
        address: "Your business address, Rajshahi, Bangladesh",
        currency: "BDT", timezone: "Asia/Dhaka",
        brandColor: "#206a53",
        socialLinks: {},
        deliveryInfo: "Inside city: ৳60. Outside city: ৳120. Charges shown before you confirm.",
        returnPolicy: "Contact us within 3 days of delivery to discuss a return.",
        privacyPolicy: "We use your details only to process and deliver your order.",
        terms: "Cash on Delivery orders are confirmed by phone before shipment.",
      },
    });
  }

  const paymentDefaults = [
    { code: "cod", name: "Cash on Delivery", enabled: true, visible: true, isDefault: true, sortOrder: 0 },
    { code: "sslcommerz", name: "SSLCommerz", sortOrder: 10 },
    { code: "bkash", name: "bKash", sortOrder: 11 },
    { code: "nagad", name: "Nagad", sortOrder: 12 },
  ];
  for (const config of paymentDefaults) {
    await prisma.paymentMethodConfiguration.upsert({
      where: { code: config.code },
      create: { ...config, sandbox: true, status: config.code === "cod" ? "configured" : "unconfigured" },
      update: {},
    });
  }

  for (const [code, name] of [["pathao", "Pathao Courier"], ["steadfast", "Steadfast Courier"], ["redx", "REDX"]]) {
    await prisma.courierProviderConfiguration.upsert({
      where: { code },
      create: { code, name, enabled: false, visible: false, sandbox: true, status: "unconfigured", sortOrder: 10 },
      update: {},
    });
  }

  for (const [code, name] of [["meta_pixel", "Meta Pixel & Conversions API"], ["google_analytics", "Google Analytics"], ["google_tag_manager", "Google Tag Manager"]]) {
    await prisma.integration.upsert({ where: { code }, create: { code, name, enabled: false, config: {} }, update: {} });
  }

  for (const [key, value] of Object.entries({
    notification_inapp: { enabled: true }, notification_email: { enabled: false }, notification_sms: { enabled: false },
    delivery: { insideCity: 60, outsideCity: 120, freeAbove: 0 },
  })) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  for (const rule of [
    { name: "Dhaka inside city", type: "area", matchValue: "Dhaka", charge: 60, priority: 10 },
  ]) {
    const exists = await prisma.deliveryRule.findFirst({ where: { name: rule.name } });
    if (!exists) await prisma.deliveryRule.create({ data: rule });
  }

  for (const template of TEMPLATES) {
    await prisma.landingPageTemplate.upsert({
      where: { code: template.code },
      create: {
        code: template.code, name: template.name, category: template.category,
        description: template.description, previewColor: template.previewColor,
        theme: template.theme, sections: template.sections as never,
      },
      update: { theme: template.theme, sections: template.sections as never, name: template.name },
    });
  }

  const sample = await prisma.product.findUnique({ where: { slug: "premium-cotton-t-shirt" } });
  if (!sample) {
    const product = await prisma.product.create({
      data: {
        name: "Premium Cotton T-Shirt", slug: "premium-cotton-t-shirt",
        sku: "TSHIRT-COTTON-001",
        shortDescription: "Soft, breathable cotton for everyday wear.",
        description: "A well-made everyday t-shirt in durable cotton. Choose your size and colour, and pay cash on delivery.",
        regularPrice: 990, salePrice: 790, status: "PUBLISHED", publishedAt: new Date(),
        attributes: ["Size", "Color"],
        specifications: [
          { name: "Fabric", value: "100% cotton" },
          { name: "Care", value: "Machine wash cold" },
        ],
        variants: {
          create: [
            { name: "Small / Black", sku: "TSHIRT-S-BLK", stock: 25, lowStockThreshold: 5, attributes: { Size: "S", Color: "Black" }, position: 0 },
            { name: "Medium / Black", sku: "TSHIRT-M-BLK", stock: 25, lowStockThreshold: 5, attributes: { Size: "M", Color: "Black" }, position: 1 },
            { name: "Large / Black", sku: "TSHIRT-L-BLK", stock: 15, lowStockThreshold: 5, attributes: { Size: "L", Color: "Black" }, position: 2 },
          ],
        },
      },
    });
    const sections = sectionsFromTemplate("fashion");
    await prisma.landingPage.create({
      data: {
        productId: product.id, slug: "premium-cotton-t-shirt", title: "Premium Cotton T-Shirt",
        status: "PUBLISHED", publishedAt: new Date(), templateCode: "fashion",
        theme: TEMPLATES[0].theme,
        seo: {
          title: "Premium Cotton T-Shirt | LANDIQ Store",
          description: "Soft, breathable cotton t-shirt with cash on delivery across Bangladesh.",
        },
        sections: {
          create: sections.map((section, position) => ({
            type: section.type, data: { ...SECTION_DEFAULTS[section.type], ...section.data } as never,
            enabled: true, position,
          })),
        },
      },
    });
  }

  console.log(`Seed complete. Owner: ${ownerEmail} / ${ownerPassword} (change after first login)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
