/* Opt-in production-mode media smoke against the matching disposable browser
 * cluster and an explicitly identified Next production process. This uses the
 * adapter-backed JS TEST client: it does not verify the native Prisma build,
 * Docker, TLS, SMTP, or a live provider. Never target a real store. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { chromium: playwright } = require("playwright");
const { expect } = require("@playwright/test");
const packaged = require("@sparticuz/chromium");

async function main() {
  if (process.env.LANDIQ_PHASE1_BROWSER_DISPOSABLE !== "1") throw new Error("Explicit disposable browser opt-in is required");
  const infoFile = path.resolve(process.env.LANDIQ_BROWSER_INFO_FILE ?? "");
  const root = path.resolve(process.cwd(), "tmp");
  if (path.dirname(infoFile) !== root || !/^phase1-browser-[a-z0-9-]+\.json$/.test(path.basename(infoFile))) throw new Error("Invalid fixture metadata path");
  const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
  const cluster = path.resolve(process.env.LANDIQ_BROWSER_CLUSTER_DIRECTORY ?? "");
  const pid = Number(process.env.LANDIQ_PRODUCTION_SERVER_PID);
  const port = Number(process.env.LANDIQ_PRODUCTION_SERVER_PORT);
  if (info.state !== "ready" || !Number.isInteger(info.pid) || !info.storeManagerEmail?.endsWith("@fixture.invalid")
    || path.dirname(cluster) !== root || !path.basename(cluster).startsWith("phase1-browser-cluster-")
    || !Number.isInteger(pid) || !Number.isInteger(port) || port < 1024 || port > 65535 || port === info.webPort) {
    throw new Error("Invalid fixture identity");
  }
  process.kill(info.pid, 0); process.kill(pid, 0);
  const harness = fs.readFileSync(`/proc/${info.pid}/cmdline`, "utf8").split("\0");
  const server = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
  const serverEnv = fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
  const preload = `NODE_OPTIONS=--require=${path.join(cluster, "browser-preload.cjs")}`;
  const listeners = execFileSync("ss", ["-lntp"], { encoding: "utf8" });
  if (!harness.some((part) => part.endsWith("tests/fixtures/phase1-browser-harness.cjs"))
    || !server.startsWith("next-server") || !serverEnv.includes(preload)
    || !listeners.split("\n").some((line) => line.includes(`:${port} `) && line.includes(`pid=${pid},`))) {
    throw new Error("Refusing browser requests: process, listener or test-client identity mismatch");
  }
  const origin = `http://127.0.0.1:${port}`;
  const libs = await packaged.inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br"));
  packaged.setupLambdaEnvironment(path.join(libs, "lib"));
  const executablePath = await packaged.default.executablePath();
  const args = packaged.default.args.filter((arg) => !arg.startsWith("--disable-web-security") && !arg.startsWith("--allow-running-insecure-content"));
  const launch = () => playwright.launch({ executablePath, args, headless: true });
  let browser = await launch();
  const check = expect.configure({ timeout: 45_000 });
  const name = `production-fixture-${randomBytes(6).toString("hex")}.png`;
  // A valid 1x1 PNG plus padding makes the form body exceed Next's old 1 MB
  // default while remaining below the advertised 20 MiB limit.
  const image = Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lZ7kAAAAASUVORK5CYII=", "base64"), Buffer.alloc(1_200_000)]);
  try {
    const context = await browser.newContext({ baseURL: origin });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email address").fill(info.storeManagerEmail);
    await page.getByLabel("Password").fill(info.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await check(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.goto("/dashboard/media", { waitUntil: "domcontentloaded" });
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await check(page.locator(".alert-success")).toContainText("File uploaded");
    const card = page.locator("div.surface").filter({ hasText: name });
    await check(card).toHaveCount(1);
    const url = await card.locator("input[readonly]").inputValue();
    if (!/^\/uploads\/\d{4}-\d{2}\/[0-9a-f-]+\.png$/.test(url)) throw new Error("Unexpected fixture upload URL");
    const response = await context.request.get(url);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect(await response.body()).toEqual(image);
    const range = await context.request.get(url, { headers: { Range: "bytes=0-7" } });
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(image.subarray(0, 8));
    await card.getByRole("button", { name: "Delete" }).click();
    await check(page.locator(".alert-success")).toContainText("Media deleted");
    expect((await context.request.get(url)).status()).toBe(404);
    console.log("Production-mode Next media smoke PASS: authenticated 1.2 MB upload, immediate fetch, range and delete; JS test client only");

    // The earlier fulfillment smoke created and published this disposable
    // product. Use a fresh anonymous context to verify the built checkout.
    await browser.close();
    browser = await launch();
    const customer = await browser.newContext({ baseURL: origin });
    await customer.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const shopper = await customer.newPage();
    await shopper.goto("/shop", { waitUntil: "domcontentloaded" });
    await shopper.getByRole("link", { name: /Manager Browser Product/ }).click();
    await check(shopper.getByRole("button", { name: /Place order/ })).toBeEnabled();
    await shopper.getByLabel(/Full name/).fill("Production Fixture Buyer");
    await shopper.getByLabel(/Phone number/).fill("01766778899");
    await shopper.getByLabel(/Full delivery address/).fill("789 Production Fixture Street");
    await shopper.getByLabel(/District/).fill("Rajshahi");
    const placed = shopper.waitForResponse((value) => value.url() === `${origin}/api/orders` && value.request().method() === "POST");
    await shopper.getByRole("button", { name: /Place order/ }).click();
    const orderResponse = await placed;
    expect(orderResponse.status()).toBe(201);
    const order = await orderResponse.json();
    await check(shopper.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
    await shopper.getByRole("link", { name: "Track your order" }).click();
    await check(shopper.getByRole("heading", { name: order.orderNumber })).toBeVisible();
    const tracking = await customer.request.get(`/track/${order.trackingToken}`);
    expect(tracking.headers()["referrer-policy"]).toBe("no-referrer");
    expect(tracking.headers()["cache-control"]).toContain("no-store");
    shopper.once("dialog", (dialog) => dialog.accept());
    await shopper.getByRole("button", { name: "Cancel order", exact: true }).click();
    await check(shopper.getByText("Your cancellation request was processed.")).toBeVisible();
    await check(shopper.getByText("Cancelled", { exact: true }).first()).toBeVisible();
    console.log("Production-mode Next COD smoke PASS: storefront, checkout, private tracking and cancellation; JS test client only");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
