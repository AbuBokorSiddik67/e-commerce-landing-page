import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";

export const couponSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.coerce.number().int().positive(),
  productId: z.string().optional().nullable(),
  minOrderValue: z.coerce.number().int().nonnegative().default(0),
  maxDiscount: z.coerce.number().int().positive().optional().nullable(),
  usageLimit: z.coerce.number().int().positive().optional().nullable(),
  firstOrderOnly: z.boolean().default(false),
  expiresAt: z.string().datetime().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  isActive: z.boolean().default(true),
});

export type CouponInput = z.input<typeof couponSchema>;

export async function createCoupon(input: CouponInput, actorId: string) {
  const data = couponSchema.parse(input);
  const code = data.code.toUpperCase();
  const exists = await prisma.coupon.findUnique({ where: { code } });
  if (exists) throw new ConflictError("This coupon code already exists");
  if (data.type === "PERCENTAGE" && data.value > 100) throw new ConflictError("Percentage cannot exceed 100");
  if (data.maxDiscount != null && data.type === "PERCENTAGE" && data.maxDiscount <= 0) throw new ConflictError("Invalid maximum discount");
  const coupon = await prisma.coupon.create({
    data: {
      code, type: data.type, value: data.value, productId: data.productId || null,
      minOrderValue: data.minOrderValue, maxDiscount: data.maxDiscount ?? null,
      usageLimit: data.usageLimit ?? null, firstOrderOnly: data.firstOrderOnly,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      isActive: data.isActive,
    },
  });
  await audit({ actorId, action: "CREATE_COUPON", entity: "Coupon", entityId: coupon.id, after: coupon });
  return coupon;
}

export async function updateCoupon(id: string, input: Partial<CouponInput>, actorId: string) {
  const existing = await prisma.coupon.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Coupon not found");
  const patch = couponSchema.partial().parse(input);
  const coupon = await prisma.coupon.update({
    where: { id },
    data: {
      ...patch,
      code: patch.code ? patch.code.toUpperCase() : undefined,
      expiresAt: patch.expiresAt ? new Date(patch.expiresAt) : patch.expiresAt === null ? null : undefined,
      startsAt: patch.startsAt ? new Date(patch.startsAt) : patch.startsAt === null ? null : undefined,
    },
  });
  await audit({ actorId, action: "UPDATE_COUPON", entity: "Coupon", entityId: id, before: existing, after: coupon });
  return coupon;
}

export async function listCoupons() {
  return prisma.coupon.findMany({ include: { product: { select: { name: true } }, _count: { select: { redemptions: true } } }, orderBy: { createdAt: "desc" } });
}
