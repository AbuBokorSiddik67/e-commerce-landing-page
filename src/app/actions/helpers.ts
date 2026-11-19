import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { toErrorMessage } from "@/lib/errors";

export function jsonField<T>(formData: FormData, key: string, fallback: T): T {
  const raw = formData.get(key);
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function str(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value : fallback;
}

export function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

export function num(formData: FormData, key: string, fallback = 0) {
  const value = Number(str(formData, key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

export function optionalStr(formData: FormData, key: string) {
  const value = str(formData, key).trim();
  return value || null;
}

/** Redirects with an encoded message; redirect() is intentionally outside try/catch. */
export async function finish(path: string, handler: () => Promise<unknown>, success = "Saved successfully") {
  let error: string | null = null;
  try {
    await handler();
  } catch (cause) {
    error = toErrorMessage(cause);
  }
  revalidatePath(path);
  redirect(`${path}${path.includes("?") ? "&" : "?"}${error ? `error=${encodeURIComponent(error)}` : `success=${encodeURIComponent(success)}`}`);
}
