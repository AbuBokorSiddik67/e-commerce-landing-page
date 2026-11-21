import { NextResponse } from "next/server";
import { processPaymentCallback } from "@/services/orders";
import { AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { readPaymentCallbackBody } from "@/lib/payments/callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  try {
    // Requires the reverse proxy to replace, rather than append untrusted IPs.
    checkRateLimit(`payment-ipn:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 300, 10 * 60 * 1000);
    const result = await processPaymentCallback(provider, await readPaymentCallbackBody(request));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    // Never reflect provider responses, credentials or internal errors to an
    // unauthenticated caller. A non-2xx still allows provider retries.
    const status = error instanceof AppError && [413, 429].includes(error.status) ? error.status : 400;
    return NextResponse.json({ error: "Payment could not be verified" }, { status });
  }
}
