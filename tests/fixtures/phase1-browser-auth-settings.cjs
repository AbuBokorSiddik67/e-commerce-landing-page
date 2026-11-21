/* Browser-only auth/staff/settings smoke for the matching opt-in disposable
 * phase1-browser-harness.cjs instance. Uses synthetic accounts, loopback-only
 * requests and the JS Prisma test client; not a production/runtime test. */
const fs = require("node:fs");
const path = require("node:path");
const { chromium: playwright } = require("playwright");
const { expect } = require("@playwright/test");
const packaged = require("@sparticuz/chromium");
const chromium = packaged.default;

async function main() {
  if (process.env.LANDIQ_PHASE1_BROWSER_DISPOSABLE !== "1") throw new Error("Explicit disposable browser opt-in is required");
  const infoFile = path.resolve(process.env.LANDIQ_BROWSER_INFO_FILE ?? "");
  if (path.dirname(infoFile) !== path.resolve(process.cwd(), "tmp") || !/^phase1-browser-[a-z0-9-]+\.json$/.test(path.basename(infoFile))) throw new Error("Invalid fixture metadata path");
  const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
  if (info.state !== "ready" || !Number.isInteger(info.webPort) || !Number.isInteger(info.pid)
    || info.adminEmail !== "browser-admin@fixture.invalid" || !info.ownerId || !info.ownerRoleId || !info.viewerRoleId) {
    throw new Error("Invalid browser fixture metadata");
  }
  process.kill(info.pid, 0);
  const origin = `http://127.0.0.1:${info.webPort}`;
  const libs = await packaged.inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br"));
  packaged.setupLambdaEnvironment(path.join(libs, "lib"));
  const executablePath = await chromium.executablePath();
  const args = chromium.args.filter((arg) => !arg.startsWith("--disable-web-security") && !arg.startsWith("--allow-running-insecure-content"));
  const launch = () => playwright.launch({ executablePath, args, headless: true });
  const check = expect.configure({ timeout: 45_000 });
  const newEmail = "browser-new-staff@fixture.invalid";
  const temporary = "Fixture-initial-pass-2026";
  const changed = "Fixture-changed-pass-2026";
  const reset = "Fixture-reset-pass-2026";
  let browser = await launch();
  let savedSession;
  async function newPage(storageState) {
    const context = await browser.newContext({ baseURL: origin, ...(storageState ? { storageState } : {}) });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    return { context, page: await context.newPage() };
  }
  async function login(page, email, password) {
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  try {
    let { page } = await newPage();
    await login(page, info.adminEmail, info.password);
    await check(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.goto("/dashboard/settings", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByRole("heading", { name: "Business settings" })).toBeVisible();
    // Redirect and business settings are distinct forms: adding one must not
    // accidentally submit the other, and the external Save button must work.
    await page.getByLabel("Business name").fill("Unsaved Fixture Name");
    const redirectForm = page.getByRole("button", { name: "Add redirect" }).locator("xpath=ancestor::form");
    await redirectForm.locator('input[name="fromPath"]').fill("/fixture-old");
    await redirectForm.locator('input[name="toPath"]').fill("/fixture-new");
    await redirectForm.getByRole("button", { name: "Add redirect" }).click();
    await check(page.getByRole("status")).toContainText("Redirect");
    await check(page.getByLabel("Business name")).toHaveValue("Disposable Browser Store");
    await page.getByLabel("Business name").fill("Updated Fixture Store");
    await page.getByRole("button", { name: "Save settings" }).click();
    await check(page.getByRole("status")).toContainText("Business settings saved");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByLabel("Business name")).toHaveValue("Updated Fixture Store");
    await check(page.getByText("/fixture-old → /fixture-new")).toBeVisible();
    console.info("Settings: independent redirect and business forms saved correctly");

    await page.goto("/dashboard/staff", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByRole("heading", { name: "Staff & permissions" })).toBeVisible();
    const ownerCard = page.locator(".surface").filter({ hasText: "browser-owner@fixture.invalid" });
    await check(ownerCard).toHaveCount(1);
    await check(ownerCard.getByRole("button", { name: "Save roles" })).toHaveCount(0);
    await check(ownerCard.getByRole("button", { name: "Reset and revoke sessions" })).toHaveCount(0);
    let createForm = page.getByRole("button", { name: "Create staff account" }).locator("xpath=ancestor::form");
    await createForm.getByLabel("Name").fill("Forged Owner Fixture");
    await createForm.getByLabel("Email").fill("browser-forged@fixture.invalid");
    await createForm.getByLabel("Initial password").fill(temporary);
    await createForm.evaluate((form, roleId) => {
      const hidden = document.createElement("input"); hidden.type = "hidden"; hidden.name = "roleIds"; hidden.value = roleId; form.appendChild(hidden);
    }, info.ownerRoleId);
    await createForm.getByRole("button", { name: "Create staff account" }).click();
    await check(page.locator('.alert-error[role="alert"]')).toContainText("invalid or cannot be assigned");
    await check(page.getByText("browser-forged@fixture.invalid")).toHaveCount(0);
    createForm = page.getByRole("button", { name: "Create staff account" }).locator("xpath=ancestor::form");
    await createForm.getByLabel("Name").fill("New Staff Fixture");
    await createForm.getByLabel("Email").fill(newEmail);
    await createForm.getByLabel("Initial password").fill(temporary);
    await createForm.locator(`input[name="roleIds"][value="${info.viewerRoleId}"]`).check();
    await createForm.getByRole("button", { name: "Create staff account" }).click();
    await check(page.getByRole("status")).toContainText("Staff account created");
    await check(page.getByText(newEmail)).toBeVisible();

    // Forge the target of a real reset form to the owner ID. No owner control
    // exists in the UI, and the server must reject the tampered POST too.
    const staffCard = page.locator(".surface").filter({ hasText: newEmail });
    let resetForm = staffCard.getByRole("button", { name: "Reset and revoke sessions" }).locator("xpath=ancestor::form");
    await resetForm.locator('input[name="id"]').evaluate((input, id) => { input.value = id; }, info.ownerId);
    await resetForm.getByPlaceholder("New temporary password").fill(reset);
    await resetForm.getByRole("button", { name: "Reset and revoke sessions" }).click();
    await check(page.locator('.alert-error[role="alert"]')).toContainText("Owner accounts cannot be modified");
    console.info("Staff: forged OWNER assignment and owner password reset rejected");

    await browser.close(); browser = await launch();
    let staff = await newPage();
    await login(staff.page, newEmail, temporary);
    await check(staff.page).toHaveURL(/\/change-password/);
    await check(staff.page.getByRole("heading", { name: "Change your password" })).toBeVisible();
    const denied = await staff.page.evaluate(async () => [
      (await fetch("/api/media")).status, (await fetch("/api/orders/export")).status,
    ]);
    expect(denied).toEqual([403, 403]);
    await staff.page.goto("/dashboard/orders", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(staff.page).toHaveURL(/\/change-password/);
    await staff.page.getByLabel("Current password").fill(temporary);
    await staff.page.getByLabel("New password").fill(changed);
    await staff.page.getByRole("button", { name: "Change password", exact: true }).click();
    await check(staff.page.getByRole("status")).toContainText("Password updated");
    await staff.page.getByRole("link", { name: "Continue to dashboard" }).click();
    await check(staff.page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(await staff.page.evaluate(async () => (await fetch("/api/orders/export")).status)).toBe(200);
    savedSession = await staff.context.storageState();
    console.info("Staff: temporary password blocked dashboard/APIs until changed");

    await browser.close(); browser = await launch();
    ({ page } = await newPage());
    await login(page, info.adminEmail, info.password);
    await check(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.goto("/dashboard/staff", { waitUntil: "domcontentloaded", timeout: 90_000 });
    resetForm = page.locator(".surface").filter({ hasText: newEmail }).getByRole("button", { name: "Reset and revoke sessions" }).locator("xpath=ancestor::form");
    await resetForm.getByPlaceholder("New temporary password").fill(reset);
    await resetForm.getByRole("button", { name: "Reset and revoke sessions" }).click();
    await check(page.getByRole("status")).toContainText("Password reset and sessions revoked");
    await browser.close(); browser = await launch();
    staff = await newPage(savedSession);
    await staff.page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(staff.page).toHaveURL(/\/login/);
    await login(staff.page, newEmail, reset);
    await check(staff.page).toHaveURL(/\/change-password/);
    await staff.page.getByRole("button", { name: "Sign out" }).click();
    await check(staff.page).toHaveURL(/\/login/);
    console.info(`Browser auth/settings smoke PASS; Chromium ${browser.version()}; JS test client only`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
