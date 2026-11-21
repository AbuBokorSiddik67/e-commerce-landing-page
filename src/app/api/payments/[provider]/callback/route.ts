import { NextResponse } from "next/server";
import { processPaymentCallback } from "@/services/orders";
import { checkRateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/config";
import { readPaymentCallbackBody } from "@/lib/payments/callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ provider: string }> };

async function payload(request: Request) {
  const url = new URL(request.url);
  const fromQuery = Object.fromEntries(url.searchParams.entries());
  const fromBody = request.method === "POST" ? await readPaymentCallbackBody(request) : {};
  return { ...fromQuery, ...fromBody };
}

export async function GET(request: Request, { params }: Context) {
  const { provider } = await params;
  return handle(request, provider, true);
}

export async function POST(request: Request, { params }: Context) {
  const { provider } = await params;
  return handle(request, provider, true);
}

async function handle(request: Request, provider: string, redirectAfter: boolean) {
  try {
    checkRateLimit(`payment-callback:${provider}:${request.headers.get("x-forwarded-for") ?? "unknown"}`, 30, 10 * 60 * 1000);
    const result = await processPaymentCallback(provider, await payload(request));
    const base = siteUrl();
    // Provider POST callbacks must redirect as GET. The callback itself is not
    // a capability to disclose the customer's private tracking token.
    if (redirectAfter) return NextResponse.redirect(`${base}/order-confirmed?order=${encodeURIComponent(result.orderNumber)}`, 303);
    return NextResponse.json(result);
  } catch {
    // Provider or infrastructure errors may contain credentials or private
    // payloads. Never reflect those details in a public redirect or response.
    const message = "Payment could not be verified. Contact the store before placing the order again.";
    if (redirectAfter) {
      const base = siteUrl();
      return NextResponse.redirect(`${base}/checkout/failed?reason=${encodeURIComponent(message)}`, 303);
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
