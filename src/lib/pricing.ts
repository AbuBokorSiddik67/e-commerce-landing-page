export type PriceInput = {
  regularPrice: number;
  salePrice?: number | null;
  variantPrice?: number | null;
  quantity: number;
};

/** Effective unit price: variant override, then sale price, then regular price. */
export function unitPrice(input: PriceInput) {
  const base = input.variantPrice ?? input.salePrice ?? input.regularPrice;
  return Math.max(0, Math.round(base));
}

export function lineTotals(input: PriceInput & { discount?: number; deliveryCharge?: number }) {
  const price = unitPrice(input);
  const subtotal = price * Math.max(1, Math.round(input.quantity));
  const discount = Math.min(Math.max(0, input.discount ?? 0), subtotal);
  const deliveryCharge = Math.max(0, input.deliveryCharge ?? 0);
  return { unitPrice: price, subtotal, discount, deliveryCharge, total: subtotal - discount + deliveryCharge };
}

export type CouponContext = {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  minOrderValue: number;
  maxDiscount?: number | null;
  productId?: string | null;
  expiresAt?: Date | null;
  startsAt?: Date | null;
  usageLimit?: number | null;
  usedCount: number;
  firstOrderOnly: boolean;
  isActive: boolean;
};

export function validateCoupon(coupon: CouponContext | null, context: {
  subtotal: number; productId: string; customerOrderCount: number; now?: Date;
}): { valid: boolean; discount: number; reason?: string } {
  const now = context.now ?? new Date();
  if (!coupon) return { valid: false, discount: 0, reason: "Invalid coupon code" };
  if (!coupon.isActive) return { valid: false, discount: 0, reason: "This coupon is not active" };
  if (coupon.startsAt && coupon.startsAt > now) return { valid: false, discount: 0, reason: "This coupon has not started" };
  if (coupon.expiresAt && coupon.expiresAt < now) return { valid: false, discount: 0, reason: "This coupon has expired" };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { valid: false, discount: 0, reason: "This coupon has reached its usage limit" };
  if (coupon.productId && coupon.productId !== context.productId) return { valid: false, discount: 0, reason: "This coupon does not apply to this product" };
  if (context.subtotal < coupon.minOrderValue) return { valid: false, discount: 0, reason: `Minimum order value is ৳${coupon.minOrderValue}` };
  if (coupon.firstOrderOnly && context.customerOrderCount > 0) return { valid: false, discount: 0, reason: "This coupon is for first orders only" };
  const raw = coupon.type === "PERCENTAGE" ? (context.subtotal * coupon.value) / 100 : coupon.value;
  const discount = Math.max(0, Math.round(Math.min(raw, coupon.maxDiscount ?? raw, context.subtotal)));
  return { valid: true, discount };
}
