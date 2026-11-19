import { NextResponse } from "next/server";
import { processPaymentCallback } from "@/services/orders";
import { toErrorMessage } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ provider: string }> };

async function payload(request: Request) {
  const url = new URL(request.url);
  const fromQuery = Object.fromEntries(url.searchParams.entries());
  let fromBody: Record<string, unknown> = {};
  if (request.method === "POST") {
    const text = await request.text();
    if (text.includes("{")) fromBody = JSON.parse(text) as Record<string, unknown>;
    else fromBody = Object.fromEntries(new URLSearchParams(text).entries());
  }
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
    const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    if (redirectAfter) return NextResponse.redirect(`${base}/order-confirmed?order=${encodeURIComponent(result.orderNumber)}&payment=${result.ok ? "verified" : "failed"}`);
    return NextResponse.json(result);
  } catch (error) {
    if (redirectAfter) {
      const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
      return NextResponse.redirect(`${base}/checkout/failed?reason=${encodeURIComponent(toErrorMessage(error))}`);
    }
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 400 });
  }
}
