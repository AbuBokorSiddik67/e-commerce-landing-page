import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/http";
import { z } from "zod";
import { calculateDeliveryCharge } from "@/lib/settings";
import { AppError } from "@/lib/errors";

const schema = z.object({
  district: z.string().min(2).max(80),
  area: z.string().max(80).optional(),
  deliveryOption: z.enum(["inside_city", "outside_city"]),
  subtotal: z.coerce.number().int().nonnegative(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid delivery details" }, { status: 400 });
    const result = await calculateDeliveryCharge({
      option: parsed.data.deliveryOption, district: parsed.data.district,
      area: parsed.data.area, subtotal: parsed.data.subtotal,
    });
    return NextResponse.json({ charge: result.charge, label: result.ruleName });
  } catch (error) {
    return NextResponse.json({ error: "Request rejected" }, { status: error instanceof AppError ? error.status : 400 });
  }
}
