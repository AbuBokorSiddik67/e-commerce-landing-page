export type Credentials = Record<string, string>;

export type ShipmentInput = {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  district: string;
  area?: string | null;
  codAmount: number;
  weightGrams: number;
  items: string;
  sandbox: boolean;
  credentials: Credentials;
  // Server-side endpoint snapshot for a durable booking claim. null means use
  // the provider default even if the process environment changes later.
  apiBaseOverride?: string | null;
};

export type CourierBooking = {
  consignmentId: string;
  trackingId: string;
  trackingUrl?: string;
  cost?: number;
  raw: Record<string, unknown>;
};

export interface CourierProvider {
  readonly code: string;
  readonly name: string;
  readonly requiredCredentials: readonly string[];
  credentialsValid(credentials: Credentials): boolean;
  testConnection(credentials: Credentials, sandbox: boolean): Promise<{ ok: boolean; message: string }>;
  calculateCharge?(input: {
    district: string; area?: string | null; weightGrams: number; sandbox: boolean; credentials: Credentials;
  }): Promise<number | null>;
  createShipment(input: ShipmentInput): Promise<CourierBooking>;
  getTracking(reference: string, credentials: Credentials, sandbox: boolean, apiBaseOverride?: string | null): Promise<{
    status: string; description?: string; at?: Date; raw: Record<string, unknown>;
  }>;
  // A boolean is only the adapter's report, not authoritative evidence of
  // physical return or even necessarily provider-confirmed cancellation.
  cancelShipment?(reference: string, credentials: Credentials, sandbox: boolean, apiBaseOverride?: string | null): Promise<boolean>;
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Courier returned non-JSON response (${response.status}): ${text.slice(0, 120)}`);
  }
  if (!response.ok) throw new Error(`Courier HTTP ${response.status}: ${JSON.stringify(parsed).slice(0, 300)}`);
  return parsed as T;
}
