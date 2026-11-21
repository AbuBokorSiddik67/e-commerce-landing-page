import { request, type CourierProvider } from "./types";

type Credentials = Record<string, string>;
const apiBase = (sandbox: boolean, override?: string | null) =>
  (override === undefined ? process.env.STEADFAST_API_BASE : override) || (sandbox ? "https://sandbox-api.steadfast.com.bd/v1" : "https://api.steadfast.com.bd/v1");

const authHeaders = (c: Credentials) => ({
  "Api-Key": c.apiKey,
  "Secret-Key": c.apiSecret,
  Accept: "application/json",
  "Content-Type": "application/json",
});

export const steadfastProvider: CourierProvider = {
  code: "steadfast",
  name: "Steadfast Courier",
  requiredCredentials: ["apiKey", "apiSecret"],
  credentialsValid: (c) => Boolean(c.apiKey?.trim() && c.apiSecret?.trim()),

  async testConnection(credentials, sandbox) {
    if (!this.credentialsValid(credentials)) return { ok: false, message: "API key and secret are required" };
    const result = await request<{ status?: number; balance?: number; message?: string }>(`${apiBase(sandbox)}/balance`, { headers: authHeaders(credentials) });
    return result.status === 200 ? { ok: true, message: "API credentials accepted" } : { ok: false, message: result.message ?? "Credentials rejected" };
  },

  async createShipment(input) {
    const result = await request<{ status?: number; consignment_id?: string; tracking_code?: string; message?: string }>(
      `${apiBase(input.sandbox, input.apiBaseOverride)}/orders/create`,
      {
        method: "POST",
        headers: authHeaders(input.credentials),
        body: JSON.stringify({
          invoice: input.orderNumber,
          recipient_name: input.customerName,
          recipient_phone: input.phone,
          recipient_address: input.address,
          cod_amount: input.codAmount,
          item_description: input.items,
          item_quantity: 1,
          item_weight: Math.max(0.5, input.weightGrams / 1000),
        }),
      },
    );
    if (!result.consignment_id && !result.tracking_code) throw new Error(result.message ?? "Steadfast order creation failed");
    const reference = String(result.consignment_id ?? result.tracking_code);
    return {
      consignmentId: reference,
      trackingId: String(result.tracking_code ?? reference),
      trackingUrl: `https://steadfast.com.bd/tracking/${result.tracking_code ?? reference}`,
      raw: result,
    };
  },

  async getTracking(reference, credentials, sandbox) {
    const result = await request<{ tracking?: { status?: string; details?: string; date?: string }; message?: string }>(
      `${apiBase(sandbox)}/orders/track/${encodeURIComponent(reference)}`, { headers: authHeaders(credentials) },
    );
    return {
      status: result.tracking?.status ?? "UNKNOWN",
      description: result.tracking?.details ?? result.message,
      at: result.tracking?.date ? new Date(result.tracking.date) : undefined,
      raw: result,
    };
  },
};
