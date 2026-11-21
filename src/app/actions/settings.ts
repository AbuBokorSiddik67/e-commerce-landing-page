"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCourierProvider } from "@/lib/couriers/registry";
import { getPaymentProvider } from "@/lib/payments/registry";
import {
  testCourierConnection, testPaymentConnection, updateBusinessSettings,
  updateCourierConfiguration, updatePaymentConfiguration, setSetting,
} from "@/lib/settings";
import { bool, finish, jsonField, num, optionalStr, str } from "./helpers";

export async function businessSettingsAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.SETTINGS_WRITE);
  await finish("/dashboard/settings", () => updateBusinessSettings({
    name: str(formData, "name"),
    legalName: optionalStr(formData, "legalName"),
    description: optionalStr(formData, "description"),
    email: optionalStr(formData, "email"),
    phone: optionalStr(formData, "phone"),
    address: optionalStr(formData, "address"),
    logoUrl: optionalStr(formData, "logoUrl"),
    faviconUrl: optionalStr(formData, "faviconUrl"),
    currency: str(formData, "currency", "BDT"),
    timezone: str(formData, "timezone", "Asia/Dhaka"),
    brandColor: str(formData, "brandColor", "#206a53"),
    socialLinks: jsonField(formData, "socialLinks", {}),
    deliveryInfo: optionalStr(formData, "deliveryInfo"),
    returnPolicy: optionalStr(formData, "returnPolicy"),
    privacyPolicy: optionalStr(formData, "privacyPolicy"),
    terms: optionalStr(formData, "terms"),
  }, user.id), "Business settings saved");
}

export async function paymentConfigAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.PAYMENT_SETTINGS);
  const code = str(formData, "code");
  await finish("/dashboard/payments", async () => {
    const provider = code === "cod" ? null : getPaymentProvider(code);
    const credentials: Record<string, string> = {};
    for (const field of provider?.requiredCredentials ?? []) {
      const value = str(formData, `cred_${field}`);
      if (value) credentials[field] = value;
    }
    await updatePaymentConfiguration(code, {
      enabled: bool(formData, "enabled"), visible: bool(formData, "visible"),
      sandbox: bool(formData, "sandbox"), isDefault: bool(formData, "isDefault"), credentials,
    }, user.id);
  }, "Payment method configuration saved");
}

export async function testPaymentAction(formData: FormData) {
  await requirePermission(PERMISSIONS.PAYMENT_SETTINGS);
  await finish("/dashboard/payments", async () => {
    const result = await testPaymentConnection(str(formData, "code"));
    if (!result.ok) throw new Error(result.message);
  }, "Connection check completed; review status and verify a real sandbox transaction");
}

export async function courierConfigAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.COURIER_SETTINGS);
  const code = str(formData, "code");
  await finish("/dashboard/couriers", async () => {
    const provider = getCourierProvider(code);
    const credentials: Record<string, string> = {};
    for (const field of provider?.requiredCredentials ?? []) {
      const value = str(formData, `cred_${field}`);
      if (value) credentials[field] = value;
    }
    await updateCourierConfiguration(code, {
      enabled: bool(formData, "enabled"), visible: bool(formData, "visible"),
      sandbox: bool(formData, "sandbox"), isDefault: bool(formData, "isDefault"), credentials,
    }, user.id);
  }, "Courier configuration saved");
}

export async function testCourierAction(formData: FormData) {
  await requirePermission(PERMISSIONS.COURIER_SETTINGS);
  await finish("/dashboard/couriers", async () => {
    const result = await testCourierConnection(str(formData, "code"));
    if (!result.ok) throw new Error(result.message);
  }, "Connection check completed; verify a real sandbox shipment");
}

export async function deliverySettingsAction(formData: FormData) {
  await requirePermission(PERMISSIONS.SETTINGS_WRITE);
  await finish("/dashboard/couriers", async () => {
    await setSetting("delivery", {
      insideCity: num(formData, "insideCity"), outsideCity: num(formData, "outsideCity"), freeAbove: num(formData, "freeAbove"),
    });
  }, "Delivery charges saved");
}

export async function deliveryRuleAction(formData: FormData) {
  await requirePermission(PERMISSIONS.SETTINGS_WRITE);
  await finish("/dashboard/couriers", async () => {
    const id = str(formData, "id");
    const data = {
      name: str(formData, "name"), type: str(formData, "type"), matchValue: str(formData, "matchValue"),
      charge: num(formData, "charge"), freeAbove: optionalStr(formData, "freeAbove") ? num(formData, "freeAbove") : null,
      priority: num(formData, "priority"), isActive: bool(formData, "isActive"),
    };
    if (id) await prisma.deliveryRule.update({ where: { id }, data });
    else await prisma.deliveryRule.create({ data });
  });
}

export async function integrationAction(formData: FormData) {
  await requirePermission(PERMISSIONS.MARKETING_SETTINGS);
  await finish("/dashboard/integrations", async () => {
    const code = str(formData, "code");
    const config: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("cfg_") && typeof value === "string") config[key.slice(4)] = value;
    }
    const integration = await prisma.integration.findUnique({ where: { code } });
    await prisma.integration.upsert({
      where: { code },
      create: { code, name: str(formData, "name", code), enabled: bool(formData, "enabled"), config },
      update: { enabled: bool(formData, "enabled"), config: { ...((integration?.config ?? {}) as object), ...config } },
    });
  }, "Integration settings saved");
}

export async function notificationChannelAction(formData: FormData) {
  await requirePermission(PERMISSIONS.SETTINGS_WRITE);
  await finish("/dashboard/notifications", async () => {
    const channel = str(formData, "channel");
    await setSetting(`notification_${channel}`, { enabled: bool(formData, "enabled") });
  }, "Notification channel updated");
}

export async function markNotificationsReadAction() {
  await requirePermission(PERMISSIONS.NOTIFICATION_VIEW);
  await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/dashboard/notifications");
}
