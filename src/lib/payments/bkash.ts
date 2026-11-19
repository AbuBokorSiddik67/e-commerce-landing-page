import { getJson, postJson, type PaymentProvider } from "./types";

type BkashResponse = {
  id_token?: string;
  status?: string;
  paymentID?: string;
  bkash_url?: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  message?: string;
  error_message?: string;
};

const base = (sandbox: boolean) =>
  sandbox ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout" : "https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout";

type TokenCache = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCache>();

async function token(credentials: Credentials, sandbox: boolean): Promise<string> {
  const key = `${sandbox}:${credentials.appKey}:${credentials.appSecret}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const result = await getJson<BkashResponse>(
    `${base(sandbox)}/token/grant?app_key=${encodeURIComponent(credentials.appKey)}&app_secret=${encodeURIComponent(credentials.appSecret)}`,
    { username: credentials.username, password: credentials.password },
  );
  if (!result.id_token) throw new Error(result.error_message ?? "bKash token grant failed");
  tokenCache.set(key, { token: result.id_token, expiresAt: Date.now() + 50 * 60 * 1000 });
  return result.id_token;
}

type Credentials = Record<string, string>;

/** bKash Tokenized Checkout: grant → create → execute, with server-side query verification. */
export const bkashProvider: PaymentProvider = {
  code: "bkash",
  name: "bKash",
  requiredCredentials: ["appKey", "appSecret", "username", "password"],
  credentialsValid: (c) => ["appKey", "appSecret", "username", "password"].every((field) => Boolean(c[field]?.trim())),

  async testConnection(credentials, sandbox) {
    if (!this.credentialsValid(credentials)) return { ok: false, message: "All four bKash credentials are required" };
    const value = await token(credentials, sandbox);
    return value ? { ok: true, message: "Token grant accepted" } : { ok: false, message: "Token grant failed" };
  },

  async initialize(input) {
    const { credentials: c, sandbox } = input;
    if (!this.credentialsValid(c)) throw new Error("bKash credentials are not configured");
    const idToken = await token(c, sandbox);
    const headers = { Authorization: idToken, "X-App-Key": c.appKey };
    const created = await postJson<BkashResponse>(`${base(sandbox)}/create`, {
      amount: String(input.amount),
      currency: "BDT",
      intent: "sale",
      payer_reference: input.customer.phone,
      callback_url: input.urls.success,
    }, headers);
    if (!created.paymentID || !created.bkash_url) throw new Error(created.error_message ?? "bKash payment creation failed");
    return {
      reference: created.paymentID,
      checkoutUrl: `${created.bkash_url}?paymentID=${encodeURIComponent(created.paymentID)}`,
      status: "INITIATED",
      raw: created,
    };
  },

  async verify(payload, credentials, sandbox) {
    const paymentID = String(payload.paymentID ?? payload.paymentId ?? "");
    const trxID = String(payload.trxID ?? payload.trxId ?? "");
    if (!paymentID || !trxID) throw new Error("Missing bKash payment identifiers");
    const idToken = await token(credentials, sandbox);
    const result = await postJson<BkashResponse>(
      `${base(sandbox)}/payment/status`,
      { paymentID, trxID },
      { Authorization: idToken, "X-App-Key": credentials.appKey },
    );
    const paid = result.transactionStatus === "Completed";
    // Reference stays the paymentID created at checkout so callbacks are idempotent.
    return { status: paid ? "PAID" : "FAILED", reference: paymentID, amount: result.amount ? Number(result.amount) : undefined, raw: result };
  },

  async refund({ reference, amount, credentials, sandbox, reason }) {
    const idToken = await token(credentials, sandbox);
    const result = await postJson<BkashResponse>(
      `${base(sandbox)}/refund`,
      { paymentID: reference, amount: String(amount), reason },
      { Authorization: idToken, "X-App-Key": credentials.appKey },
    );
    return result.transactionStatus === "Completed"
      ? { status: "REFUNDED", providerReference: reference, raw: result }
      : { status: "PENDING", raw: result };
  },
};
