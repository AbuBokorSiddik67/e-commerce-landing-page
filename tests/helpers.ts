import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function resetDatabase() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%'
  `;
  if (!rows.length) return;
  const list = rows.map((row) => `"${row.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createOwner() {
  return prisma.user.create({
    data: { name: "Test Owner", email: `owner-${Math.random().toString(36).slice(2, 9)}@landiq.local`, passwordHash: "test-hash" },
  });
}

export async function createBusiness() {
  return prisma.businessSetting.create({
    data: { name: "Test Store", currency: "BDT", brandColor: "#206a53" },
  });
}

export async function setPayment(code: string, patch: {
  enabled?: boolean; visible?: boolean; sandbox?: boolean; isDefault?: boolean; credentials?: Record<string, string>;
}) {
  const names: Record<string, string> = { cod: "Cash on Delivery", sslcommerz: "SSLCommerz", bkash: "bKash", nagad: "Nagad" };
  return prisma.paymentMethodConfiguration.upsert({
    where: { code },
    create: { code, name: names[code] ?? code, enabled: false, visible: false, credentials: patch.credentials ?? {}, ...patch },
    update: { ...patch, credentials: patch.credentials ?? {} },
  });
}

export async function setCourier(code: string, patch: { enabled?: boolean; visible?: boolean; credentials?: Record<string, string> }) {
  const names: Record<string, string> = { pathao: "Pathao", steadfast: "Steadfast", redx: "REDX" };
  return prisma.courierProviderConfiguration.upsert({
    where: { code },
    create: { code, name: names[code] ?? code, enabled: false, visible: false, credentials: patch.credentials ?? {}, ...patch },
    update: { ...patch, credentials: patch.credentials ?? {} },
  });
}

export async function createProduct(opts: { stock?: number; price?: number; status?: "DRAFT" | "PUBLISHED"; slug?: string } = {}) {
  const slug = opts.slug ?? `test-product-${Math.random().toString(36).slice(2, 8)}`;
  const product = await prisma.product.create({
    data: {
      name: "Test Product", slug, regularPrice: opts.price ?? 1000, salePrice: null,
      status: opts.status ?? "PUBLISHED", publishedAt: new Date(),
      variants: { create: { name: "Default", sku: `SKU-${slug}`, stock: opts.stock ?? 10, price: null } },
    },
    include: { variants: true },
  });
  await prisma.landingPage.create({
    data: { productId: product.id, slug, title: "Test Product", status: "PUBLISHED", publishedAt: new Date() },
  });
  return product;
}

export const checkout = (productId: string, variantId: string, paymentMethod = "cod") => ({
  productId, variantId, quantity: 1, paymentMethod,
  customer: {
    name: "Test Buyer", phone: `017${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
    email: "buyer@example.com", address: "123 Test Street", district: "Rajshahi", area: "City",
  },
  deliveryOption: "inside_city" as const,
});

export async function closeAll() {
  await prisma.$disconnect();
}
