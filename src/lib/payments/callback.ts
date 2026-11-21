import { readLimitedText } from "@/lib/http";

// Hosted payment callbacks are small form posts or JSON objects. Keeping this
// independent of the media upload limit protects public endpoints from large
// untrusted bodies. No request fields are treated as proof of payment.
export async function readPaymentCallbackBody(request: Request): Promise<Record<string, unknown>> {
  const text = await readLimitedText(request, 64 * 1024);
  const isJson = request.headers.get("content-type")?.toLowerCase().includes("application/json") || text.trimStart().startsWith("{");
  if (!isJson) return Object.fromEntries(new URLSearchParams(text).entries());
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid callback body");
  return parsed as Record<string, unknown>;
}
