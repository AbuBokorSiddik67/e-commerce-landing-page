import type { CourierProvider } from "./types";
import { pathaoProvider } from "./pathao";
import { steadfastProvider } from "./steadfast";
import { redxProvider } from "./redx";

export const COURIER_PROVIDERS: CourierProvider[] = [pathaoProvider, steadfastProvider, redxProvider];

export function getCourierProvider(code: string) {
  return COURIER_PROVIDERS.find((p) => p.code === code) ?? null;
}

export const COURIER_PROVIDER_INFO = COURIER_PROVIDERS.map((p) => ({
  code: p.code,
  name: p.name,
  fields: [...p.requiredCredentials],
}));
