import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/http";
import { placeOrder } from "@/services/orders";
import { checkRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { ZodError } from "zod";
import { headers } from "next/headers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    checkRateLimit(`place-order-ip:${ip}`, 20, 60 * 60 * 1000);
    const body = await request.json();
    const result = await placeOrder({ ...body, ip });
    return NextResponse.json({
      ok: true,
      orderNumber: result.order.orderNumber,
      trackingToken: result.order.trackingToken,
      total: result.order.total,
      checkoutUrl: result.checkoutUrl,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid order details" }, { status: 400 });
    // Internal/DB errors can include sensitive infrastructure details. If a
    // response was lost, the client retains its checkout key for a safe retry.
    return NextResponse.json({ error: "Unable to complete the order. Retry with the same details or contact the store." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use the published landing page to place an order" }, { status: 405 });
}
