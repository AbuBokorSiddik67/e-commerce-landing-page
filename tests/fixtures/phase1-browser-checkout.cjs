/* Public checkout smoke for the matching opt-in disposable browser harness.
 * Only synthetic COD and loopback browser requests are permitted. The first
 * real server response is deliberately discarded after the server commits.
 * The packaged browser and JS Prisma client do not verify a production build. */
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
    || !/^browser-checkout-[0-9a-f-]+$/.test(info.checkoutSlug ?? "") || !info.checkoutProductId
    || !/^browser-cancel-[0-9a-f-]+$/.test(info.cancelSlug ?? "") || !info.cancelProductId
    || !info.managerEmail?.endsWith("@fixture.invalid")) throw new Error("Invalid browser fixture metadata");
  process.kill(info.pid, 0);
  const origin = `http://127.0.0.1:${info.webPort}`;
  const libs = await packaged.inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br"));
  packaged.setupLambdaEnvironment(path.join(libs, "lib"));
  const executablePath = await chromium.executablePath();
  const args = chromium.args.filter((arg) => !arg.startsWith("--disable-web-security") && !arg.startsWith("--allow-running-insecure-content"));
  const launch = () => playwright.launch({ executablePath, args, headless: true });
  const check = expect.configure({ timeout: 45_000 });
  let browser = await launch();
  try {
    const context = await browser.newContext({ baseURL: origin });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    let firstResponse, firstPayload, orderRequests = 0;
    let finishFirst, failFirst;
    const firstFinished = new Promise((resolve, reject) => { finishFirst = resolve; failFirst = reject; });
    const page = await context.newPage();
    const url = `/p/${info.checkoutSlug}`;
    const fill = async () => {
      await page.getByLabel(/Full name/).fill("Checkout Fixture Buyer");
      await page.getByLabel(/Phone number/).fill("01722223333");
      await page.getByLabel(/Full delivery address/).fill("123 Checkout Fixture Street");
      await page.getByLabel(/District/).fill("Rajshahi");
      await page.getByLabel(/Quantity/).fill("2");
    };
    await page.goto("/shop", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByRole("heading", { name: "Browse products" })).toBeVisible();
    await page.getByRole("link", { name: /Browser Cancellation Item/ }).click();
    await check(page.getByRole("heading", { name: "Browser Cancellation Item", level: 1 })).toBeVisible();
    await check(page.getByRole("button", { name: /Place order/ })).toBeEnabled();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await check(page.getByRole("status")).toHaveText("Added to cart.");
    await page.goto("/shop", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByRole("link", { name: /Checkout Browser Item/ }).click();
    await check(page.getByRole("button", { name: /Place order/ })).toBeEnabled();
    await page.getByLabel(/Quantity/).fill("2");
    await page.getByRole("button", { name: "Add to cart" }).click();
    await check(page.getByRole("status")).toHaveText("Added to cart.");
    await page.goto("/cart", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const checkoutCartItem = page.locator(".surface").filter({ hasText: "Checkout Browser Item" });
    await check(checkoutCartItem).toContainText("Quantity 2");
    await check(page.locator(".surface").filter({ hasText: "Browser Cancellation Item" })).toHaveCount(1);
    await checkoutCartItem.getByRole("link", { name: "Checkout" }).click();
    await check(page.getByLabel(/Quantity/)).toHaveValue("2");
    await check(page.getByRole("button", { name: /Place order/ })).toBeEnabled();
    // Compile the development endpoint with an invalid synthetic request
    // before filling the form, so Fast Refresh cannot discard an in-flight UI.
    const warmup = await page.evaluate(async () => {
      const headers = { "Content-Type": "application/json" };
      const orders = await fetch("/api/orders", { method: "POST", headers, body: "{}" });
      const quote = await fetch("/api/delivery-quote", { method: "POST", headers,
        body: JSON.stringify({ district: "Rajshahi", deliveryOption: "inside_city", subtotal: 1000 }) });
      return [orders.status, quote.status];
    });
    expect(warmup).toEqual([400, 200]);
    await check(page.getByRole("button", { name: /Place order/ })).toBeEnabled();
    await context.route("**/api/orders", async (route) => {
      orderRequests += 1;
      if (orderRequests !== 1) return route.continue();
      try {
        firstPayload = route.request().postDataJSON();
        const result = await route.fetch(); // actual server/database response, not a mocked order
        firstResponse = { status: result.status(), body: await result.json() };
        await route.abort("failed"); // simulate loss after commit
        finishFirst();
      } catch (error) { failFirst(error); }
    });
    await fill();
    await page.getByRole("button", { name: /Place order/ }).click();
    await firstFinished;
    await check(page.locator('form [role="alert"]')).toBeVisible();
    expect(firstResponse?.status).toBe(201);
    expect(firstResponse.body).toMatchObject({ ok: true, orderNumber: expect.any(String), trackingToken: expect.any(String), checkoutUrl: null });
    expect(firstPayload).toMatchObject({ productId: info.checkoutProductId, quantity: 2, paymentMethod: "cod", idempotencyKey: expect.any(String) });
    const storageKey = `landiq:checkout:${info.checkoutProductId}`;
    const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey);
    expect(saved).toEqual({ key: firstPayload.idempotencyKey, submitted: true });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByText(/retry in this tab/)).toBeVisible();
    await check(page.locator('select[name="variant"] option').filter({ hasText: "out of stock" })).toHaveCount(1);
    await check(page.getByLabel(/Quantity/)).not.toHaveAttribute("readonly", "");

    // A holder of the key must still present the identical checkout details.
    // Wrong details or an unrelated key cannot retrieve the tracking token.
    const changed = await page.evaluate(async (payload) => {
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, quantity: 1 }) });
      return { status: response.status, body: await response.json() };
    }, firstPayload);
    expect(changed.status).toBe(409);
    expect(changed.body).not.toHaveProperty("trackingToken");
    expect(changed.body.error).toMatch(/different details|staff review/i);
    const unrelated = await page.evaluate(async (payload) => {
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: crypto.randomUUID() }) });
      return { status: response.status, body: await response.json() };
    }, firstPayload);
    expect(unrelated.status).toBe(409);
    expect(unrelated.body).not.toHaveProperty("trackingToken");

    await fill();
    await check(page.getByRole("button", { name: /Place order/ })).toBeEnabled();
    const retryResponse = page.waitForResponse((response) => response.url() === `${origin}/api/orders` && response.request().method() === "POST", { timeout: 90_000 });
    await page.getByRole("button", { name: /Place order/ }).click();
    const retry = await retryResponse;
    expect(retry.status()).toBe(201);
    const retryBody = await retry.json();
    expect(retryBody.orderNumber).toBe(firstResponse.body.orderNumber);
    expect(retryBody.trackingToken).toBe(firstResponse.body.trackingToken);
    await check(page.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
    await check(page.getByText(firstResponse.body.orderNumber, { exact: true })).toBeVisible();
    // An order number and spoofed payment flag alone must not disclose details.
    await page.goto(`/order-confirmed?order=${encodeURIComponent(firstResponse.body.orderNumber)}&payment=verified`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByRole("heading", { name: "Order confirmation unavailable" })).toBeVisible();
    await check(page.getByText(firstResponse.body.orderNumber, { exact: true })).toHaveCount(0);
    await page.goto("/cart", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.locator(".surface").filter({ hasText: "Checkout Browser Item" })).toHaveCount(0);
    await check(page.locator(".surface").filter({ hasText: "Browser Cancellation Item" })).toHaveCount(1);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByText(/retry in this tab/)).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Start a different order" }).click();
    const replacement = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey);
    expect(replacement.submitted).toBe(false);
    expect(replacement.key).not.toBe(saved.key);
    await check(page.getByRole("button", { name: /Place order/ })).toBeDisabled();
    console.info("Public COD: catalog/cart, lost committed response, reload, sold-out retry, private confirmation and explicit new order verified");

    // Checkout the remaining cart item as a separate order, then cancel it
    // through its private tracking link. The fallback page has no sections.
    await page.goto("/cart", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator(".surface").filter({ hasText: "Browser Cancellation Item" }).getByRole("link", { name: "Checkout" }).click();
    await check(page.getByRole("heading", { name: "Browser Cancellation Item", level: 1 })).toBeVisible();
    await check(page.getByRole("button", { name: /Place order/ })).toBeEnabled();
    await page.getByLabel(/Full name/).fill("Cancellation Fixture Buyer");
    await page.getByLabel(/Phone number/).fill("01744445555");
    await page.getByLabel(/Full delivery address/).fill("456 Cancellation Fixture Street");
    await page.getByLabel(/District/).fill("Rajshahi");
    const cancellationResponse = page.waitForResponse((response) => response.url() === `${origin}/api/orders` && response.request().method() === "POST", { timeout: 90_000 });
    await page.getByRole("button", { name: /Place order/ }).click();
    const cancelledOrderResponse = await cancellationResponse;
    expect(cancelledOrderResponse.status()).toBe(201);
    const cancelledOrder = await cancelledOrderResponse.json();
    await check(page.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
    await page.getByRole("link", { name: "Track your order" }).click();
    await check(page.getByRole("heading", { name: cancelledOrder.orderNumber })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cancel order", exact: true }).click();
    await check(page.getByText("Your cancellation request was processed.")).toBeVisible();
    await check(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
    await check(page.getByRole("button", { name: "Cancel order", exact: true })).toHaveCount(0);
    await page.goto("/cart", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByText("Your cart is empty.")).toBeVisible();
    console.info("Public COD: second cart item, fallback checkout and token-authorized cancellation verified");

    // Independently inspect the resulting order and stock in the real dashboard.
    // Use a fresh browser process: this Lambda headless build runs single-process.
    await browser.close();
    browser = await launch();
    const managerContext = await browser.newContext({ baseURL: origin });
    await managerContext.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const manager = await managerContext.newPage();
    await manager.goto("/login", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await manager.getByLabel("Email address").fill(info.managerEmail);
    await manager.getByLabel("Password").fill(info.password);
    await manager.getByRole("button", { name: "Sign in" }).click();
    await check(manager.getByRole("heading", { name: "Overview" })).toBeVisible();
    await manager.goto(`/dashboard/orders?search=${encodeURIComponent("Checkout Fixture Buyer")}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const rows = manager.locator("tbody tr").filter({ hasText: "Checkout Fixture Buyer" });
    await check(rows).toHaveCount(1);
    await check(rows.first()).toContainText(firstResponse.body.orderNumber);
    await check(rows.first()).toContainText("Checkout Browser Item");
    await manager.goto("/dashboard/inventory", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const inventory = manager.locator("tr").filter({ hasText: "Checkout Browser Item" });
    await check(inventory).toHaveCount(1);
    await check(inventory.locator("td").nth(2)).toHaveText("0");
    await check(inventory.locator("td").nth(3)).toHaveText("0");
    const sales = manager.locator("div.border-b").filter({ hasText: "Checkout Browser Item" }).filter({ hasText: "SALE" });
    await check(sales).toHaveCount(1);
    await check(sales.first()).toContainText("-2");
    const cancelledInventory = manager.locator("tr").filter({ hasText: "Browser Cancellation Item" });
    await check(cancelledInventory).toHaveCount(1);
    await check(cancelledInventory.locator("td").nth(2)).toHaveText("2");
    await check(manager.locator("div.border-b").filter({ hasText: "Browser Cancellation Item" }).filter({ has: manager.locator("p").filter({ hasText: /^CANCELLATION · sellable/ }) })).toHaveCount(1);
    console.info(`Customer browser smoke PASS; persisted COD, cancellation and stock verified; Chromium ${browser.version()}; JS test client only`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
