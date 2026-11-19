import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/http";
import { placeOrder } from "@/services/orders";
import { checkRateLimit } from "@/lib/rate-limit";
import { AppError, toErrorMessage } from "@/lib/errors";
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
    return NextResponse.json({ error: toErrorMessage(error) }, { status: error instanceof AppError ? error.status : 400 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use the published landing page to place an order" }, { status: 405 });
}
