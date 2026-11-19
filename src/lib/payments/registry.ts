import type { PaymentProvider } from "./types";
import { sslcommerzProvider } from "./sslcommerz";
import { bkashProvider } from "./bkash";
import { nagadProvider } from "./nagad";

export const PAYMENT_PROVIDERS: PaymentProvider[] = [sslcommerzProvider, bkashProvider, nagadProvider];

export function getPaymentProvider(code: string) {
  return PAYMENT_PROVIDERS.find((p) => p.code === code) ?? null;
}

export const PAYMENT_PROVIDER_INFO = [
  { code: "cod", name: "Cash on Delivery", description: "No gateway or credentials required.", fields: [] as string[] },
  ...PAYMENT_PROVIDERS.map((p) => ({
    code: p.code,
    name: p.name,
    description: "Requires merchant credentials and approval from the provider.",
    fields: [...p.requiredCredentials],
  })),
];
