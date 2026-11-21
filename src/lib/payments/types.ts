export type Credentials = Record<string, string>;

export type PaymentCustomer = {
  name: string;
  email?: string | null;
  phone: string;
  address: string;
  district: string;
};

export type PaymentInitInput = {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  sandbox: boolean;
  credentials: Credentials;
  customer: PaymentCustomer;
  urls: { success: string; fail: string; cancel: string; ipn: string };
};

export type PaymentInitResult = {
  reference: string;
  checkoutUrl?: string;
  status: "INITIATED";
  raw?: Record<string, unknown>;
};

export type PaymentVerification = {
  status: "PAID" | "FAILED" | "PENDING";
  // These values must come from the provider's verified response, not the
  // callback request. Missing data is deliberately represented as absent.
  reference: string;
  amount?: number;
  currency?: string;
  // A failed attempt is not necessarily a closed checkout session. Only a
  // provider-backed terminal-session check may set this flag to true.
  terminalFailureVerified?: boolean;
  raw: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly code: string;
  readonly name: string;
  readonly requiredCredentials: readonly string[];
  credentialsValid(credentials: Credentials): boolean;
  testConnection(credentials: Credentials, sandbox: boolean): Promise<{ ok: boolean; message: string }>;
  initialize(input: PaymentInitInput): Promise<PaymentInitResult>;
  verify(payload: Record<string, unknown>, credentials: Credentials, sandbox: boolean): Promise<PaymentVerification>;
  refund?(input: {
    reference: string; amount: number; credentials: Credentials; sandbox: boolean; reason: string;
  }): Promise<{ status: "REFUNDED" | "PENDING"; providerReference?: string; raw?: Record<string, unknown> }>;
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch { throw new Error("Provider request failed"); }
  return parseResponse<T>(response);
}

export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch { throw new Error("Provider request failed"); }
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  // Gateway errors may echo request parameters, tokens and customer data.
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  let text: string;
  try { text = await response.text(); }
  catch { throw new Error("Provider response could not be read"); }
  try { return (text ? JSON.parse(text) : {}) as T; }
  catch { throw new Error(`Provider returned non-JSON response (${response.status})`); }
}
