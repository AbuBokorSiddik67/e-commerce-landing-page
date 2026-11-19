import { describe, expect, it } from "vitest";
import { lineTotals, unitPrice, validateCoupon, type CouponContext } from "@/lib/pricing";

describe("pricing", () => {
  it("prefers variant price over sale price and regular price", () => {
    expect(unitPrice({ regularPrice: 1000, salePrice: 800, variantPrice: 750, quantity: 1 })).toBe(750);
    expect(unitPrice({ regularPrice: 1000, salePrice: 800, quantity: 1 })).toBe(800);
    expect(unitPrice({ regularPrice: 1000, quantity: 1 })).toBe(1000);
  });

  it("calculates totals with capped discount and delivery", () => {
    const result = lineTotals({ regularPrice: 1000, quantity: 2, discount: 250, deliveryCharge: 60 });
    expect(result).toEqual({ unitPrice: 1000, subtotal: 2000, discount: 250, deliveryCharge: 60, total: 1810 });
    const capped = lineTotals({ regularPrice: 100, quantity: 1, discount: 500 });
    expect(capped.discount).toBe(100);
    expect(capped.total).toBe(0);
  });
});

const baseCoupon: CouponContext = {
  code: "TEST", type: "PERCENTAGE", value: 10, minOrderValue: 500, maxDiscount: 150,
  usedCount: 0, firstOrderOnly: false, isActive: true,
};

describe("coupon validation", () => {
  it("applies percentage discount within maximum", () => {
    const result = validateCoupon(baseCoupon, { subtotal: 2000, productId: "p1", customerOrderCount: 0 });
    expect(result).toMatchObject({ valid: true, discount: 150 });
  });

  it("rejects expired, inactive, first-order and product mismatches", () => {
    const now = new Date();
    expect(validateCoupon({ ...baseCoupon, expiresAt: new Date(now.getTime() - 1000) }, { subtotal: 2000, productId: "p1", customerOrderCount: 0, now }).reason).toMatch(/expired/);
    expect(validateCoupon({ ...baseCoupon, isActive: false }, { subtotal: 2000, productId: "p1", customerOrderCount: 0, now }).reason).toMatch(/active/);
    expect(validateCoupon({ ...baseCoupon, firstOrderOnly: true }, { subtotal: 2000, productId: "p1", customerOrderCount: 2, now }).reason).toMatch(/first orders/);
    expect(validateCoupon({ ...baseCoupon, productId: "other" }, { subtotal: 2000, productId: "p1", customerOrderCount: 0, now }).reason).toMatch(/does not apply/);
  });

  it("rejects usage limits and minimum order values", () => {
    expect(validateCoupon({ ...baseCoupon, usageLimit: 2, usedCount: 2 }, { subtotal: 2000, productId: "p1", customerOrderCount: 0 }).valid).toBe(false);
    expect(validateCoupon(baseCoupon, { subtotal: 400, productId: "p1", customerOrderCount: 0 }).valid).toBe(false);
    expect(validateCoupon(null, { subtotal: 400, productId: "p1", customerOrderCount: 0 }).reason).toMatch(/Invalid/);
  });
});
