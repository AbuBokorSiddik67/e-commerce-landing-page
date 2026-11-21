import { NextResponse } from "next/server";
import { z } from "zod";
import { recordEvent } from "@/services/analytics";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { headers } from "next/headers";

const schema = z.object({
  type: z.enum(["page_view", "view_content", "cta_click", "initiate_checkout"]),
  pageId: z.string().max(60).optional(),
  productId: z.string().max(60).optional(),
  visitorId: z.string().min(4).max(100),
  metadata: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const h = await headers();
    checkRateLimit(`events:${h.get("x-forwarded-for") ?? "unknown"}`, 60, 60_000);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    await recordEvent(parsed.data);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: "Request rejected" }, { status: error instanceof AppError ? error.status : 400 });
  }
}
