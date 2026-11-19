import { request, type CourierProvider } from "./types";

type Credentials = Record<string, string>;
const apiBase = (sandbox: boolean) =>
  process.env.PATHAO_API_BASE || (sandbox ? "https://sandbox-api.pathao.com" : "https://api.pathao.com");

let tokenCache: { token: string; expiresAt: number } | null = null;
async function accessToken(c: Credentials, sandbox: boolean) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const result = await request<{ access_token?: string; expires_in?: number; message?: string }>(
    `${apiBase(sandbox)}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: c.clientId,
        client_secret: c.clientSecret,
        scope: "merchant",
      }),
    },
  );
  if (!result.access_token) throw new Error(result.message ?? "Pathao token request failed");
  tokenCache = { token: result.access_token, expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

const headers = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" });

export const pathaoProvider: CourierProvider = {
  code: "pathao",
  name: "Pathao Courier",
  requiredCredentials: ["clientId", "clientSecret"],
  credentialsValid: (c) => Boolean(c.clientId?.trim() && c.clientSecret?.trim()),

  async testConnection(credentials, sandbox) {
    if (!this.credentialsValid(credentials)) return { ok: false, message: "Client ID and secret are required" };
    const value = await accessToken(credentials, sandbox);
    return value ? { ok: true, message: "OAuth token accepted" } : { ok: false, message: "Token request failed" };
  },

  async calculateCharge({ district, area, weightGrams, sandbox, credentials }) {
    const token = await accessToken(credentials, sandbox);
    const cities = await request<{ data?: { city_id?: number; city_name?: string }[] }>(`${apiBase(sandbox)}/api/v1/areas/cities`, { headers: headers(token) });
    const city = cities.data?.find((c) => c.city_name?.toLowerCase() === district.toLowerCase());
    if (!city?.city_id) return null;
    const result = await request<{ data?: { fee?: number } }>(`${apiBase(sandbox)}/api/v1/price/calculate`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ city_id: city.city_id, zone_id: 0, item_type: 2, weight: Math.max(0.5, weightGrams / 1000) }),
    });
    return result.data?.fee != null ? Number(result.data.fee) : null;
  },

  async createShipment(input) {
    const token = await accessToken(input.credentials, input.sandbox);
    const result = await request<{ data?: { consignment_id?: string; merchant_order_id?: string; tracking_code?: string }; message?: string }>(
      `${apiBase(input.sandbox)}/api/v1/orders`,
      {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          merchant_order_id: input.orderNumber,
          recipient_name: input.customerName,
          recipient_phone: input.phone,
          recipient_address: input.address,
          recipient_city: input.district,
          recipient_zone: input.area ?? input.district,
          cod_amount: input.codAmount,
          item_quantity: 1,
          item_weight: Math.max(0.5, input.weightGrams / 1000),
          item_description: input.items,
          delivery_type: 1,
        }),
      },
    );
    const id = result.data?.consignment_id ?? result.data?.merchant_order_id;
    if (!id) throw new Error(result.message ?? "Pathao order creation failed");
    return {
      consignmentId: String(id),
      trackingId: String(result.data?.tracking_code ?? id),
      trackingUrl: `https://pathao.com/track/${result.data?.tracking_code ?? id}`,
      raw: result,
    };
  },

  async getTracking(reference, credentials, sandbox) {
    const token = await accessToken(credentials, sandbox);
    const result = await request<{ data?: { status?: string; description?: string; updated_at?: string } }>(
      `${apiBase(sandbox)}/api/v1/orders/${encodeURIComponent(reference)}`,
      { headers: headers(token) },
    );
    return { status: result.data?.status ?? "UNKNOWN", description: result.data?.description, at: result.data?.updated_at ? new Date(result.data.updated_at) : undefined, raw: result };
  },

  async cancelShipment(reference, credentials, sandbox) {
    const token = await accessToken(credentials, sandbox);
    await request(`${apiBase(sandbox)}/api/v1/orders/${encodeURIComponent(reference)}/cancel`, {
      method: "POST", headers: headers(token),
    });
    return true;
  },
};
