import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";

export type MarketingEvent = {
  name: "PageView" | "ViewContent" | "InitiateCheckout" | "Purchase";
  orderId?: string;
  value?: number;
  currency?: string;
  visitorId: string;
  email?: string | null;
  phone?: string | null;
};

export async function getPublicIntegrations() {
  const rows = await prisma.integration.findMany({ where: { enabled: true } });
  const config = (code: string) => (rows.find((r) => r.code === code)?.config ?? {}) as Record<string, string>;
  const meta = config("meta_pixel");
  const ga = config("google_analytics");
  const gtm = config("google_tag_manager");
  return {
    metaPixelId: meta.pixelId || "",
    googleAnalyticsId: ga.measurementId || "",
    gtmId: gtm.containerId || "",
    metaCapiEnabled: Boolean(meta.capiEnabled === "true" && meta.pixelId),
  };
}

function hash(value?: string | null) {
  return value ? createHash("sha256").update(value.trim().toLowerCase()).digest("hex") : "";
}

/** Server-side Meta Conversions API event with deterministic deduplication. */
export async function sendServerPurchaseEvent(input: MarketingEvent) {
  if (input.name !== "Purchase" || !input.orderId || !input.value) return;
  const row = await prisma.integration.findUnique({ where: { code: "meta_pixel" } });
  const config = (row?.config ?? {}) as Record<string, string>;
  if (!row?.enabled || config.capiEnabled !== "true" || !config.pixelId) return;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!accessToken) return;
  const eventId = `${input.orderId}-purchase`;
  const userData: Record<string, string> = {};
  if (hash(input.email)) userData.em = hash(input.email);
  if (hash(input.phone)) userData.ph = hash(input.phone);
  try {
    await fetch(`https://graph.facebook.com/v20.0/${config.pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          user_data: userData,
          custom_data: { value: input.value, currency: input.currency ?? "BDT", order_id: input.orderId },
          action_source: "website",
        }],
      }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Meta CAPI HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    });
  } catch {
    // Marketing must never break order processing; delivery logs capture failures in production monitoring.
  }
}
