import { expect, test } from "@playwright/test";

test("owner can log in and see the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@landiq.local");
  await page.getByLabel("Password").fill("Owner@123456789");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("customer can open a published landing page and place a COD order", async ({ page }) => {
  await page.goto("/p/premium-cotton-t-shirt");
  await expect(page.getByRole("heading", { name: /Premium Cotton T-Shirt/ }).first()).toBeVisible();
  await page.getByLabel("Full name *").fill("Playwright Buyer");
  await page.getByLabel("Phone number *").fill("01711112222");
  await page.getByLabel("Full delivery address *").fill("Road 4, Rajshahi");
  await page.getByLabel("District / City *").fill("Rajshahi");
  await page.getByRole("button", { name: /place order/i }).click();
  await expect(page).toHaveURL(/order-confirmed/);
  await expect(page.getByText(/Thank you for your order/)).toBeVisible();
});

test("tracking link does not expose the full phone number", async ({ page }) => {
  await page.goto("/track/invalid-token");
  await expect(page.getByText("Tracking link not found")).toBeVisible();
});
