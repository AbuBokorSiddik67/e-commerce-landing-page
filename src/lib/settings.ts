import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto";
import { getPaymentProvider, PAYMENT_PROVIDER_INFO } from "./payments/registry";
import { getCourierProvider, COURIER_PROVIDER_INFO } from "./couriers/registry";
import type { Credentials as PaymentCredentials } from "./payments/types";
import type { Credentials as CourierCredentials } from "./couriers/types";
import { ConflictError } from "./errors";

export type BusinessSettingsInput = {
  name: string;
  legalName?: string | null;
  description?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  currency?: string;
  timezone?: string;
  socialLinks?: Record<string, string>;
  deliveryInfo?: string | null;
  returnPolicy?: string | null;
  privacyPolicy?: string | null;
  terms?: string | null;
  brandColor?: string;
};

const defaultBusiness = {
  name: "LANDIQ Store",
  description: "Quality products, delivered with care.",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  brandColor: "#206a53",
  socialLinks: {},
};

export async function getBusinessSettings() {
  const existing = await prisma.businessSetting.findFirst();
  if (existing) return existing;
  return prisma.businessSetting.create({ data: defaultBusiness });
}

export async function updateBusinessSettings(input: BusinessSettingsInput, actorId?: string) {
  const current = await getBusinessSettings();
  const updated = await prisma.businessSetting.update({
    where: { id: current.id },
    data: {
      ...input,
      socialLinks: (input.socialLinks ?? {}) as never,
    },
  });
  const { audit } = await import("./audit");
  await audit({ actorId, action: "UPDATE_BUSINESS_SETTINGS", entity: "BusinessSetting", entityId: current.id, before: current, after: updated });
  return updated;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

function decodeCredentials(raw: unknown): Record<string, string> {
  const source = (raw ?? {}) as Record<string, string>;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value?.startsWith("enc:")) {
      try {
        result[key] = decryptSecret(value.slice(4));
      } catch {
        result[key] = "";
      }
    } else {
      result[key] = value ?? "";
    }
  }
  return result;
}

function encodeCredentials(current: unknown, patch: Record<string, unknown>, fields: readonly string[]) {
  const result: Record<string, string> = { ...decodeCredentials(current) };
  for (const field of fields) {
    if (patch[field] === undefined) continue;
    const value = String(patch[field] ?? "");
    result[field] = value ? `enc:${encryptSecret(value)}` : "";
  }
  return result;
}

function envFallback(prefix: string, key: string) {
  const map: Record<string, string> = {
    storeId: "STORE_ID", storePassword: "STORE_PASSWORD",
    appKey: "APP_KEY", appSecret: "APP_SECRET", username: "USERNAME", password: "PASSWORD",
    merchantId: "MERCHANT_ID", publicKey: "PUBLIC_KEY", privateKey: "PRIVATE_KEY",
    clientId: "CLIENT_ID", clientSecret: "CLIENT_SECRET", apiKey: "API_KEY", apiSecret: "API_SECRET",
  };
  return process.env[`${prefix}_${map[key] ?? key.toUpperCase()}`] ?? "";
}

function withEnvFallback(c: Record<string, string>, prefix: string, fields: readonly string[]) {
  const merged = { ...c };
  for (const field of fields) if (!merged[field]) merged[field] = envFallback(prefix, field);
  return merged;
}

export type PublicPaymentMethod = {
  code: string;
  name: string;
  isDefault: boolean;
  sandbox: boolean;
};

/** Only enabled + publicly visible + correctly configured methods reach checkout. */
export async function getCheckoutPaymentMethods(): Promise<PublicPaymentMethod[]> {
  const configs = await prisma.paymentMethodConfiguration.findMany({ orderBy: { sortOrder: "asc" } });
  const methods: PublicPaymentMethod[] = [];
  for (const config of configs) {
    if (!config.enabled || !config.visible) continue;
    if (config.code === "cod") {
      methods.push({ code: "cod", name: config.name, isDefault: config.isDefault, sandbox: false });
      continue;
    }
    const provider = getPaymentProvider(config.code);
    if (!provider) continue;
    const credentials = withEnvFallback(decodeCredentials(config.credentials), config.code.toUpperCase(), provider.requiredCredentials);
    if (!provider.credentialsValid(credentials)) continue;
    methods.push({ code: config.code, name: config.name, isDefault: config.isDefault, sandbox: config.sandbox });
  }
  return methods;
}

export async function assertPaymentMethodAvailable(code: string) {
  const allowed = await getCheckoutPaymentMethods();
  const found = allowed.find((m) => m.code === code);
  if (!found) throw new ConflictError("The selected payment method is not available");
  return found;
}

export async function getPaymentConfigurations() {
  const rows = await prisma.paymentMethodConfiguration.findMany({ orderBy: { sortOrder: "asc" } });
  return PAYMENT_PROVIDER_INFO.map((info) => {
    const row = rows.find((r) => r.code === info.code);
    let configured = info.code === "cod";
    if (info.code !== "cod") {
      const provider = getPaymentProvider(info.code);
      if (provider) {
        const credentials = withEnvFallback(decodeCredentials(row?.credentials), info.code.toUpperCase(), provider.requiredCredentials);
        configured = provider.credentialsValid(credentials);
      }
    }
    return {
      code: info.code,
      name: info.name,
      description: info.description,
      fields: info.fields,
      enabled: row?.enabled ?? info.code === "cod",
      visible: row?.visible ?? info.code === "cod",
      sandbox: row?.sandbox ?? true,
      isDefault: row?.isDefault ?? info.code === "cod",
      configured,
      status: configured ? (row?.status ?? "configured") : "unconfigured",
      lastTestedAt: row?.lastTestedAt ?? null,
      lastError: row?.lastError ?? null,
    };
  });
}

export async function updatePaymentConfiguration(code: string, patch: {
  enabled?: boolean; visible?: boolean; sandbox?: boolean; isDefault?: boolean; credentials?: Record<string, unknown>;
}, actorId?: string) {
  const info = PAYMENT_PROVIDER_INFO.find((p) => p.code === code);
  if (!info) throw new ConflictError("Unknown payment method");
  const existing = await prisma.paymentMethodConfiguration.findUnique({ where: { code } });
  const provider = code === "cod" ? null : getPaymentProvider(code);
  const credentials = provider
    ? encodeCredentials(existing?.credentials, patch.credentials ?? {}, provider.requiredCredentials)
    : {};
  if (patch.isDefault) {
    await prisma.paymentMethodConfiguration.updateMany({ data: { isDefault: false } });
  }
  const data = {
    enabled: patch.enabled ?? existing?.enabled ?? false,
    visible: patch.visible ?? existing?.visible ?? false,
    sandbox: patch.sandbox ?? existing?.sandbox ?? true,
    isDefault: patch.isDefault ?? existing?.isDefault ?? false,
    credentials: credentials as never,
    ...(Object.keys(patch.credentials ?? {}).length ? { status: "credentials_saved" } : {}),
  };
  const config = await prisma.paymentMethodConfiguration.upsert({
    where: { code },
    create: { code, name: info.name, ...data, sortOrder: code === "cod" ? 0 : 10 },
    update: data,
  });
  const { audit } = await import("./audit");
  await audit({ actorId, action: "UPDATE_PAYMENT_METHOD", entity: "PaymentMethodConfiguration", entityId: config.id, before: existing, after: { code, ...data, credentials: "[redacted]" } });
  return config;
}

export async function testPaymentConnection(code: string) {
  if (code === "cod") return { ok: true, message: "COD requires no external connection" };
  const provider = getPaymentProvider(code);
  if (!provider) throw new ConflictError("Unknown payment provider");
  const row = await prisma.paymentMethodConfiguration.findUnique({ where: { code } });
  const credentials = withEnvFallback(decodeCredentials(row?.credentials), code.toUpperCase(), provider.requiredCredentials);
  try {
    const result = await provider.testConnection(credentials as PaymentCredentials, row?.sandbox ?? true);
    await prisma.paymentMethodConfiguration.upsert({
      where: { code },
      create: { code, name: provider.name, status: result.ok ? "connected" : "failed", lastTestedAt: new Date(), lastError: result.ok ? null : result.message },
      update: { status: result.ok ? "connected" : "failed", lastTestedAt: new Date(), lastError: result.ok ? null : result.message },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed";
    await prisma.paymentMethodConfiguration.update({ where: { code }, data: { status: "failed", lastTestedAt: new Date(), lastError: message } });
    return { ok: false, message };
  }
}

export type PublicCourier = { code: string; name: string; isDefault: boolean };

export async function getCheckoutCouriers(): Promise<PublicCourier[]> {
  const rows = await prisma.courierProviderConfiguration.findMany({ where: { enabled: true, visible: true }, orderBy: { sortOrder: "asc" } });
  const result: PublicCourier[] = [];
  for (const row of rows) {
    const provider = getCourierProvider(row.code);
    if (!provider) continue;
    const credentials = withEnvFallback(decodeCredentials(row.credentials), row.code.toUpperCase(), provider.requiredCredentials);
    if (!provider.credentialsValid(credentials)) continue;
    result.push({ code: row.code, name: row.name, isDefault: row.isDefault });
  }
  return result;
}

export async function getCourierConfigurations() {
  const rows = await prisma.courierProviderConfiguration.findMany({ orderBy: { sortOrder: "asc" } });
  return COURIER_PROVIDER_INFO.map((info) => {
    const row = rows.find((r) => r.code === info.code);
    const provider = getCourierProvider(info.code);
    const credentials = row ? withEnvFallback(decodeCredentials(row.credentials), info.code.toUpperCase(), provider?.requiredCredentials ?? []) : {};
    const configured = Boolean(provider && provider.credentialsValid(credentials));
    return {
      code: info.code, name: info.name, fields: info.fields,
      enabled: row?.enabled ?? false, visible: row?.visible ?? false,
      sandbox: row?.sandbox ?? true, isDefault: row?.isDefault ?? false,
      configured, status: configured ? (row?.status ?? "configured") : "unconfigured",
      lastTestedAt: row?.lastTestedAt ?? null, lastError: row?.lastError ?? null,
    };
  });
}

export async function updateCourierConfiguration(code: string, patch: {
  enabled?: boolean; visible?: boolean; sandbox?: boolean; isDefault?: boolean; credentials?: Record<string, unknown>;
}, actorId?: string) {
  const info = COURIER_PROVIDER_INFO.find((p) => p.code === code);
  if (!info) throw new ConflictError("Unknown courier");
  const provider = getCourierProvider(code);
  if (!provider) throw new ConflictError("Unknown courier");
  const existing = await prisma.courierProviderConfiguration.findUnique({ where: { code } });
  const credentials = encodeCredentials(existing?.credentials, patch.credentials ?? {}, provider.requiredCredentials);
  if (patch.isDefault) await prisma.courierProviderConfiguration.updateMany({ data: { isDefault: false } });
  const data = {
    enabled: patch.enabled ?? existing?.enabled ?? false,
    visible: patch.visible ?? existing?.visible ?? false,
    sandbox: patch.sandbox ?? existing?.sandbox ?? true,
    isDefault: patch.isDefault ?? existing?.isDefault ?? false,
    credentials: credentials as never,
    ...(Object.keys(patch.credentials ?? {}).length ? { status: "credentials_saved" } : {}),
  };
  const config = await prisma.courierProviderConfiguration.upsert({
    where: { code }, create: { code, name: info.name, ...data }, update: data,
  });
  const { audit } = await import("./audit");
  await audit({ actorId, action: "UPDATE_COURIER", entity: "CourierProviderConfiguration", entityId: config.id, before: existing, after: { code, ...data, credentials: "[redacted]" } });
  return config;
}

export async function testCourierConnection(code: string) {
  const provider = getCourierProvider(code);
  if (!provider) throw new ConflictError("Unknown courier");
  const row = await prisma.courierProviderConfiguration.findUnique({ where: { code } });
  const credentials = withEnvFallback(decodeCredentials(row?.credentials), code.toUpperCase(), provider.requiredCredentials);
  try {
    const result = await provider.testConnection(credentials as CourierCredentials, row?.sandbox ?? true);
    await prisma.courierProviderConfiguration.upsert({
      where: { code },
      create: { code, name: provider.name, status: result.ok ? "connected" : "failed", lastTestedAt: new Date(), lastError: result.ok ? null : result.message },
      update: { status: result.ok ? "connected" : "failed", lastTestedAt: new Date(), lastError: result.ok ? null : result.message },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed";
    await prisma.courierProviderConfiguration.update({ where: { code }, data: { status: "failed", lastTestedAt: new Date(), lastError: message } });
    return { ok: false, message };
  }
}

export type DeliveryQuote = { charge: number; ruleName: string };

/** Deterministic, seller-configured charges. Never calls a courier API at checkout. */
export async function calculateDeliveryCharge(input: {
  option: string; district: string; area?: string | null; subtotal: number;
}): Promise<DeliveryQuote> {
  const delivery = await getSetting<{ insideCity: number; outsideCity: number; freeAbove: number }>("delivery", {
    insideCity: 60, outsideCity: 120, freeAbove: 0,
  });
  if (delivery.freeAbove > 0 && input.subtotal >= delivery.freeAbove) return { charge: 0, ruleName: "Free delivery threshold" };
  const rules = await prisma.deliveryRule.findMany({ where: { isActive: true }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
  for (const rule of rules) {
    const matches =
      (rule.type === "district" && rule.matchValue.toLowerCase() === input.district.toLowerCase()) ||
      (rule.type === "area" && (input.area ?? "").toLowerCase() === rule.matchValue.toLowerCase()) ||
      (rule.type === "option" && rule.matchValue === input.option);
    if (matches && (!rule.freeAbove || input.subtotal < rule.freeAbove)) return { charge: rule.charge, ruleName: rule.name };
  }
  const charge = input.option === "inside_city" ? delivery.insideCity : delivery.outsideCity;
  return { charge, ruleName: input.option === "inside_city" ? "Inside city" : "Outside city" };
}

export async function getPaymentCredential(code: string): Promise<PaymentCredentials> {
  const provider = getPaymentProvider(code);
  if (!provider) throw new ConflictError("Unknown payment provider");
  const row = await prisma.paymentMethodConfiguration.findUnique({ where: { code } });
  return withEnvFallback(decodeCredentials(row?.credentials), code.toUpperCase(), provider.requiredCredentials) as PaymentCredentials;
}

export async function getCourierCredential(code: string): Promise<CourierCredentials> {
  const provider = getCourierProvider(code);
  if (!provider) throw new ConflictError("Unknown courier");
  const row = await prisma.courierProviderConfiguration.findUnique({ where: { code } });
  return withEnvFallback(decodeCredentials(row?.credentials), code.toUpperCase(), provider.requiredCredentials) as CourierCredentials;
}
