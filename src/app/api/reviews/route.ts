import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { ZodError } from "zod";
import { submitReview } from "@/services/reviews";
import { headers } from "next/headers";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const h = await headers();
    const ip = h.get("x-forwarded-for") ?? "unknown";
    checkRateLimit(`review:${ip}`, 5, 60 * 60 * 1000);
    const body = await request.json();
    const review = await submitReview(body);
    return NextResponse.json({ ok: true, status: review.status }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid review details" }, { status: 400 });
    return NextResponse.json({ error: "Unable to submit review" }, { status: 500 });
  }
}
