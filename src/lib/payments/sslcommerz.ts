import type { PaymentProvider } from "./types";
import { postJson } from "./types";

type SslResponse = {
  status?: string;
  gatewayPageURL?: string;
  error?: string;
  val_id?: string;
  tran_id?: string;
  amount?: string;
  currency?: string;
  message?: string;
};

const base = (sandbox: boolean) =>
  sandbox ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com";

/** SSLCommerz v4 hosted checkout + v2 validation API. */
export const sslcommerzProvider: PaymentProvider = {
  code: "sslcommerz",
  name: "SSLCommerz",
  requiredCredentials: ["storeId", "storePassword"],
  credentialsValid: (c) => Boolean(c.storeId?.trim() && c.storePassword?.trim()),

  async testConnection(credentials, sandbox) {
    if (!this.credentialsValid(credentials)) return { ok: false, message: "Store ID and store password are required" };
    // A harmless validation lookup; an invalid credential pair returns a failed status.
    const result = await postJson<SslResponse>(
      `${base(sandbox)}/validate/v2/validate.php`,
      { store_id: credentials.storeId, store_passwd: credentials.storePassword, val_id: "TEST", v: 1, format: "json" },
    );
    const message = result.message ?? result.error ?? JSON.stringify(result);
    return { ok: /invalid|validation/i.test(message) === false && result.status !== "FAILED", message };
  },

  async initialize(input) {
    const { credentials: c, sandbox } = input;
    if (!this.credentialsValid(c)) throw new Error("SSLCommerz credentials are not configured");
    const tran_id = `LDQ-${input.orderId.slice(-10)}-${Date.now().toString().slice(-6)}`;
    const result = await postJson<SslResponse>(`${base(sandbox)}/gwprocess/v4/api.php`, {
      store_id: c.storeId,
      store_passwd: c.storePassword,
      total_amount: input.amount,
      currency: input.currency,
      tran_id,
      success_url: input.urls.success,
      fail_url: input.urls.fail,
      cancel_url: input.urls.cancel,
      ipn_url: input.urls.ipn,
      cus_name: input.customer.name,
      cus_email: input.customer.email || "customer@example.com",
      cus_add1: input.customer.address,
      cus_city: input.customer.district,
      cus_country: "Bangladesh",
      cus_phone: input.customer.phone,
      shipping_method: "NO",
      product_name: "LANDIQ Order",
      product_category: "General",
      product_profile: "general",
      num_item: "1",
      item_name: "Order Items",
      item_category: "General",
    });
    if (result.status !== "VALID" || !result.gatewayPageURL) {
      throw new Error(result.error ?? `SSLCommerz initialization failed: ${JSON.stringify(result)}`);
    }
    return { reference: result.tran_id ?? tran_id, checkoutUrl: result.gatewayPageURL, status: "INITIATED", raw: result };
  },

  async verify(payload, credentials, sandbox) {
    const valId = String(payload.val_id ?? "");
    const reference = String(payload.tran_id ?? payload.tranId ?? "");
    if (!valId && !reference) throw new Error("Missing validation identifier");
    if (!this.credentialsValid(credentials)) throw new Error("SSLCommerz credentials are not configured");
    const result = await postJson<SslResponse>(`${base(sandbox)}/validate/v2/validate.php`, {
      store_id: credentials.storeId,
      store_passwd: credentials.storePassword,
      val_id: valId || reference,
      v: 1,
      format: "json",
    });
    const valid = ["VALID", "VALIDATED"].includes(result.status ?? "");
    return {
      status: valid ? "PAID" : "FAILED",
      reference: result.tran_id ?? reference,
      amount: result.amount ? Number(result.amount) : undefined,
      raw: result,
    };
  },

  async refund({ reference, amount, credentials, sandbox, reason }) {
    if (!this.credentialsValid(credentials)) throw new Error("SSLCommerz credentials are not configured");
    const result = await postJson<SslResponse>(`${base(sandbox)}/gwprocess/v3/refund/api.php`, {
      store_id: credentials.storeId,
      store_passwd: credentials.storePassword,
      refund_amount: amount,
      tran_id: reference,
      reason,
    });
    if (result.status === "VALID") return { status: "REFUNDED", providerReference: reference, raw: result };
    return { status: "PENDING", raw: result };
  },
};
