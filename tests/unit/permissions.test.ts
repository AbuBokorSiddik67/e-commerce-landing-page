import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, hasPermission, permissionsForRoles, PERMISSIONS } from "@/lib/permissions";

describe("role-based access control", () => {
  it("grants the owner every permission", () => {
    expect(permissionsForRoles(["OWNER"]).size).toBe(ALL_PERMISSIONS.length);
    expect(hasPermission(["OWNER"], PERMISSIONS.SETTINGS_WRITE)).toBe(true);
  });

  it("keeps specialised roles limited", () => {
    expect(hasPermission(["PRODUCT_MANAGER"], PERMISSIONS.PRODUCT_WRITE)).toBe(true);
    expect(hasPermission(["PRODUCT_MANAGER"], PERMISSIONS.PAYMENT_SETTINGS)).toBe(false);
    expect(hasPermission(["ORDER_MANAGER"], PERMISSIONS.ORDER_WRITE)).toBe(true);
    expect(hasPermission(["ORDER_MANAGER"], PERMISSIONS.PAGE_PUBLISH)).toBe(false);
    expect(hasPermission(["VIEWER"], PERMISSIONS.PRODUCT_WRITE)).toBe(false);
  });

  it("combines permissions across roles", () => {
    const perms = permissionsForRoles(["PRODUCT_MANAGER", "MARKETING_MANAGER"]);
    expect(perms.has(PERMISSIONS.PRODUCT_WRITE)).toBe(true);
    expect(perms.has(PERMISSIONS.MARKETING_SETTINGS)).toBe(true);
    expect(perms.has(PERMISSIONS.STAFF_WRITE)).toBe(false);
  });
});
