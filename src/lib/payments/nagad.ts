import { createHash, publicEncrypt, sign } from "node:crypto";
import { getJson, postJson, type PaymentProvider } from "./types";

type NagadResponse = Record<string, unknown>;

const apiBase = (sandbox: boolean) =>
  process.env.NAGAD_API_BASE ||
  (sandbox ? "https://sandbox.mynagad.com:10080/remote-payment-gateway-apis/remote-payment-gateway" : "https://api.mynagad.com/api/remote-payment-gateway-apis/remote-payment-gateway");

function encryptWithPublicKey(value: string, pem: string) {
  return publicEncrypt({ key: pem.replace(/\\n/g, "\n"), padding: 4 /* RSA_PKCS1_PADDING */ }, Buffer.from(value)).toString("base64");
}

function signRequest(value: string, pem: string) {
  return sign("sha256", Buffer.from(value), { key: pem.replace(/\\n/g, "\n"), padding: 4 }).toString("base64");
}

/**
 * Nagad Remote Payment Gateway integration. RSA encryption + signature are
 * performed server-side; callback data is never trusted without a status query.
 * Live verification requires approved merchant keys (see docs/ENVIRONMENT.md).
 */
export const nagadProvider: PaymentProvider = {
  code: "nagad",
  name: "Nagad",
  requiredCredentials: ["merchantId", "publicKey", "privateKey"],
  credentialsValid: (c) => ["merchantId", "publicKey", "privateKey"].every((field) => Boolean(c[field]?.trim())),

  async testConnection(credentials, sandbox) {
    if (!this.credentialsValid(credentials)) return { ok: false, message: "Merchant ID and RSA keys are required" };
    try {
      signRequest("connection-test", credentials.privateKey);
      encryptWithPublicKey("connection-test", credentials.publicKey);
      return { ok: true, message: "Local RSA key validation passed; live approval still required" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Invalid keys" };
    }
  },

  async initialize(input) {
    const { credentials: c, sandbox } = input;
    if (!this.credentialsValid(c)) throw new Error("Nagad credentials are not configured");
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const orderId = `LDQ${input.orderId.slice(-8)}${Date.now().toString().slice(-5)}`;
    const charge = "0";
    const amountWithCharge = input.amount + Number(charge);
    const signedValue = `${input.amount},${orderId},${c.merchantId},${date},${input.urls.ipn}`;
    const body = {
      date,
      merchantId: c.merchantId,
      amount: encryptWithPublicKey(String(amountWithCharge), c.publicKey),
      orderId,
      customerIP: "127.0.0.1",
      callBackUrl: input.urls.success,
      validateUrl: input.urls.ipn,
      signature: signRequest(signedValue, c.privateKey),
    };
    const result = await postJson<NagadResponse>(`${apiBase(sandbox)}/initialize`, body, {
      "Content-Type": "application/json",
      "X-KM-Api-Version": "v-0.2.0",
      "X-KM-IP-V4": "127.0.0.1",
      "X-KM-Client-Type": "PC_WEB",
    });
    const paymentRefId = String(result.paymentRefId ?? "");
    const gatewayUrl = String(result.paymentGatewayUrl ?? "");
    if (!paymentRefId || !gatewayUrl) throw new Error(`Nagad initialization failed: ${JSON.stringify(result).slice(0, 300)}`);
    return { reference: paymentRefId, checkoutUrl: gatewayUrl, status: "INITIATED", raw: result };
  },

  async verify(payload, credentials, sandbox) {
    const paymentRefId = String(payload.paymentRefId ?? payload.payment_ref_id ?? "");
    const orderId = String(payload.orderId ?? "");
    if (!paymentRefId || !orderId) throw new Error("Missing Nagad verification identifiers");
    const result = await getJson<NagadResponse>(
      `${apiBase(sandbox)}/verify/payment/${encodeURIComponent(paymentRefId)}`,
      { "X-KM-Api-Version": "v-0.2.0", "X-KM-Client-Type": "PC_WEB", merchantId: credentials.merchantId, orderId },
    );
    const status = String(result.status ?? result.paymentStatus ?? "PENDING").toUpperCase();
    return {
      status: status === "SUCCESS" || status === "COMPLETE" ? "PAID" : status === "FAILED" ? "FAILED" : "PENDING",
      reference: paymentRefId,
      raw: result,
    };
  },

  async refund({ reference, amount, credentials, sandbox, reason }) {
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const signature = signRequest(`${amount},${reference},${credentials.merchantId},${date},${reason}`, credentials.privateKey);
    const result = await postJson<NagadResponse>(`${apiBase(sandbox)}/refund`, {
      date, merchantId: credentials.merchantId, paymentRefId: reference, amount, reason, signature,
    });
    return String(result.status ?? "").toUpperCase() === "SUCCESS"
      ? { status: "REFUNDED", providerReference: reference, raw: result }
      : { status: "PENDING", raw: result };
  },
};

export { createHash };
