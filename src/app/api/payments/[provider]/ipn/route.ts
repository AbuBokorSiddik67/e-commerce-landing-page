import { NextResponse } from "next/server";
import { processPaymentCallback } from "@/services/orders";
import { toErrorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  try {
    const text = await request.text();
    const body = text.includes("{") ? JSON.parse(text) as Record<string, unknown> : Object.fromEntries(new URLSearchParams(text).entries());
    const result = await processPaymentCallback(provider, body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    // Providers retry on non-2xx; the failure is recorded via webhook events.
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 400 });
  }
}
