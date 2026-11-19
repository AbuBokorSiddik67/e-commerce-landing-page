import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export function formatMoney(amount: number, currency = "BDT") {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(value: Date | string, options?: Intl.DateTimeFormatOptions) {
  const formatOptions: Intl.DateTimeFormatOptions = options?.dateStyle || options?.timeStyle
    ? { dateStyle: "medium", ...options }
    : { day: "numeric", month: "short", year: "numeric", ...options };
  return new Intl.DateTimeFormat("en-BD", formatOptions).format(new Date(value));
}

export function maskPhone(phone: string) {
  const clean = phone.replace(/\D/g, "");
  if (clean.length <= 4) return "••••";
  return `${clean.slice(0, 3)}••••${clean.slice(-2)}`;
}

export function maskAddress(address: string) {
  if (address.length <= 8) return "••••";
  return `${address.slice(0, 6)}…, ${address.slice(-Math.min(12, address.length - 6))}`;
}

export function truncate(value: string, length = 120) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

export function uniqueSlug(base: string) {
  return `${base || "item"}-${Math.random().toString(36).slice(2, 7)}`;
}

export function daysAgo(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}
