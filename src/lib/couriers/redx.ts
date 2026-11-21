import { request, type CourierProvider } from "./types";

type Credentials = Record<string, string>;
const apiBase = (sandbox: boolean, override?: string | null) =>
  (override === undefined ? process.env.REDX_API_BASE : override) || (sandbox ? "https://sandboxapi.redx.com.bd/v1" : "https://api.redx.com.bd/v1");

export const redxProvider: CourierProvider = {
  code: "redx",
  name: "REDX",
  requiredCredentials: ["apiKey"],
  credentialsValid: (c) => Boolean(c.apiKey?.trim()),

  async testConnection(credentials, sandbox) {
    if (!this.credentialsValid(credentials)) return { ok: false, message: "API key is required" };
    const result = await request<{ token?: string; message?: string }>(`${apiBase(sandbox)}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-KEY": credentials.apiKey },
      body: "{}",
    });
    return result.token ? { ok: true, message: "API key accepted" } : { ok: false, message: "Token request failed" };
  },

  async calculateCharge({ district, weightGrams, sandbox, credentials }) {
    const auth = await request<{ token?: string }>(`${apiBase(sandbox)}/auth/token`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": credentials.apiKey }, body: "{}",
    });
    if (!auth.token) return null;
    const result = await request<{ delivery_fee?: number }>(`${apiBase(sandbox)}/pricing/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ district_name: district, weight: Math.max(0.5, weightGrams / 1000) }),
    });
    return result.delivery_fee != null ? Number(result.delivery_fee) : null;
  },

  async createShipment(input) {
    const base = apiBase(input.sandbox, input.apiBaseOverride);
    const auth = await request<{ token?: string; message?: string }>(`${base}/auth/token`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": input.credentials.apiKey }, body: "{}",
    });
    if (!auth.token) throw new Error("REDX authentication failed");
    const result = await request<{ parcel?: { id?: string; tracking_id?: string; delivery_fee?: number }; message?: string }>(
      `${base}/parcel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({
          merchant_order_id: input.orderNumber,
          customer_name: input.customerName,
          customer_phone: input.phone,
          customer_address: input.address,
          district_name: input.district,
          area_name: input.area ?? input.district,
          cod_amount: input.codAmount,
          parcel_weight: Math.max(0.5, input.weightGrams / 1000),
          item_description: input.items,
        }),
      },
    );
    const id = result.parcel?.id ?? result.parcel?.tracking_id;
    if (!id) throw new Error("REDX parcel creation failed");
    return {
      consignmentId: String(id),
      trackingId: String(result.parcel?.tracking_id ?? id),
      trackingUrl: `https://www.redx.com.bd/track-parcel/${result.parcel?.tracking_id ?? id}`,
      cost: result.parcel?.delivery_fee,
      raw: result,
    };
  },

  async getTracking(reference, credentials, sandbox, apiBaseOverride) {
    const base = apiBase(sandbox, apiBaseOverride);
    const auth = await request<{ token?: string }>(`${base}/auth/token`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": credentials.apiKey }, body: "{}",
    });
    if (!auth.token) throw new Error("REDX authentication failed");
    const result = await request<{ parcel?: { status?: string; updated_at?: string } }>(
      `${base}/parcel/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    return { status: result.parcel?.status ?? "UNKNOWN", at: result.parcel?.updated_at ? new Date(result.parcel.updated_at) : undefined, raw: result };
  },
};
