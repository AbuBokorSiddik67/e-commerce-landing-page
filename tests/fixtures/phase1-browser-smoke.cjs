/* Run only against the matching opt-in phase1-browser-harness.cjs instance.
 * Requires the npm-packaged @sparticuz/chromium for this disposable test only.
 * No external browser request is allowed and no provider is contacted. */
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
    || !info.managerEmail?.endsWith("@fixture.invalid") || !info.viewerEmail?.endsWith("@fixture.invalid")) throw new Error("Invalid browser fixture metadata");
  process.kill(info.pid, 0);
  const origin = `http://127.0.0.1:${info.webPort}`;
  const libs = await packaged.inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br"));
  packaged.setupLambdaEnvironment(path.join(libs, "lib"));
  const executablePath = await chromium.executablePath();
  // Keep browser web security enabled; the package's default Lambda flags
  // disable it, which is unnecessary for this local same-origin test.
  const args = chromium.args.filter((arg) => !arg.startsWith("--disable-web-security") && !arg.startsWith("--allow-running-insecure-content"));
  const launch = () => playwright.launch({ executablePath, args, headless: true });
  let browser = await launch();
  const check = expect.configure({ timeout: 45_000 });
  async function contextFor(email) {
    const context = await browser.newContext({ baseURL: origin });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(info.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await check(page).toHaveURL(/\/dashboard(?:\?|$)/);
    // The URL may change before the login response and session cookie settle.
    await check(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    return { context, page };
  }
  async function inventoryBalance(page, sellable, damaged) {
    await page.goto("/dashboard/inventory", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    const row = page.locator("tr").filter({ hasText: "Browser Fixture Item" });
    await check(row).toHaveCount(1);
    await check(row.locator("td").nth(2)).toHaveText(String(sellable));
    await check(row.locator("td").nth(3)).toHaveText(String(damaged));
  }
  try {
    // Capture a valid, not-yet-submitted receipt action as the manager, then
    // try the same fields in a separate VIEWER session before any receipt exists.
    const initialManager = await contextFor(info.managerEmail);
    await initialManager.page.goto(`/dashboard/orders/${info.orderId}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const receiptForm = initialManager.page.getByRole("button", { name: "Record receipt" }).locator("xpath=ancestor::form");
    await receiptForm.locator('input[name="quantity"]').fill("2");
    await check(receiptForm.locator('input[name="idempotencyKey"]')).not.toHaveValue("");
    const receiptFields = await receiptForm.evaluate((form) => [...new FormData(form).entries()]);
    if (!receiptFields.some(([name]) => name.startsWith("$ACTION_ID_")) || receiptFields.some(([, value]) => typeof value !== "string")) {
      throw new Error("Could not capture a valid synthetic receipt action");
    }
    await browser.close();
    browser = await launch();
    const unprivileged = await contextFor(info.viewerEmail);
    await unprivileged.page.goto(`/dashboard/orders/${info.orderId}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(unprivileged.page.getByText("Awaiting inspection; no inventory credited.")).toHaveCount(0);
    const denied = await unprivileged.page.evaluate(async ({ entries, url }) => {
      const data = new FormData();
      for (const [name, value] of entries) data.append(name, value);
      const response = await fetch(url, { method: "POST", body: data, redirect: "manual" });
      return response.status;
    }, { entries: receiptFields, url: `/dashboard/orders/${info.orderId}` });
    // Next dev maps this thrown ForbiddenError to HTTP 500; the server log
    // retains code FORBIDDEN. Other versions may expose 403 directly.
    expect([403, 500]).toContain(denied);
    await unprivileged.page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(unprivileged.page.getByText("Awaiting inspection; no inventory credited.")).toHaveCount(0);
    await inventoryBalance(unprivileged.page, 1, 0);
    console.info("VIEWER: direct forged receipt action rejected; receipt and stock unchanged");

    await browser.close();
    browser = await launch();
    const manager = await contextFor(info.managerEmail);
    await manager.page.goto("/dashboard/orders", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(manager.page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
    await check(manager.page.locator(`a[href="/dashboard/orders/${info.orderId}"]`)).toBeVisible();
    await manager.page.goto(`/dashboard/orders/${info.orderId}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(manager.page.getByText("APPROVED · Browser fixture physical return")).toBeVisible();
    await manager.page.locator('input[name="quantity"]').fill("2");
    await check(manager.page.locator('input[name="idempotencyKey"]').first()).not.toHaveValue("");
    await manager.page.getByRole("button", { name: "Record receipt" }).click();
    await check(manager.page.getByText("Awaiting inspection; no inventory credited.")).toBeVisible();
    await inventoryBalance(manager.page, 1, 0);
    await manager.page.goto(`/dashboard/orders/${info.orderId}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await manager.page.getByLabel("Sellable units").fill("1");
    await manager.page.getByLabel("Damaged units").fill("1");
    await manager.page.getByRole("button", { name: "Post inspection" }).click();
    await check(manager.page.getByText(/Inspected: 1 sellable, 1 damaged/)).toBeVisible();
    await inventoryBalance(manager.page, 2, 1);
    await check(manager.page.getByText(/RETURN · sellable/)).toBeVisible();
    await check(manager.page.getByText(/RETURN · damaged/)).toBeVisible();
    await manager.page.goto("/dashboard/returns", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(manager.page.getByRole("heading", { name: "Returns & refunds" })).toBeVisible();
    await check(manager.page.getByText(/Receipts: 1 · Awaiting inspection: 0/)).toBeVisible();
    console.info("ORDER_MANAGER: orders, receipt, inspection, returns and sellable/damaged inventory verified in Chromium");
    // The single-process Lambda shell does not reliably isolate simultaneous
    // contexts. Use a fresh browser process for the distinct viewer session.
    await browser.close();
    browser = await launch();
    const viewer = await contextFor(info.viewerEmail);
    await viewer.page.goto("/dashboard/orders", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(viewer.page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
    await viewer.page.goto(`/dashboard/orders/${info.orderId}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(viewer.page.getByText(/Inspected: 1 sellable, 1 damaged/)).toBeVisible();
    for (const name of ["Record cancellation", "Post inspection", "Record COD collection", "Mark COD settled",
      "Record refund (no provider call)", "Request provider refund", "Save note"]) {
      await check(viewer.page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await inventoryBalance(viewer.page, 2, 1);
    await check(viewer.page.getByRole("button", { name: "Set", exact: true })).toHaveCount(0);
    await viewer.page.goto("/dashboard/returns", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(viewer.page.getByText(/Receipts: 1 · Awaiting inspection: 0/)).toBeVisible();
    console.info("VIEWER: authorized read access to orders, returns and inventory verified in Chromium");
    console.info(`Browser smoke PASS; Chromium ${browser.version()}; JS test client only (not a production build)`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
