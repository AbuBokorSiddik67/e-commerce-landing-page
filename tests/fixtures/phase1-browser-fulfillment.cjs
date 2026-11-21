/* Opt-in authorization and fulfillment smoke for the matching disposable
 * phase1-browser-harness.cjs instance. All records and users are synthetic.
 * Browser requests are restricted to the fixture origin; no provider is called.
 * This development-server/JS-client test is not a production-build check. */
const fs = require("node:fs");
const path = require("node:path");
const { chromium: playwright } = require("playwright");
const { expect } = require("@playwright/test");
const packaged = require("@sparticuz/chromium");
const chromium = packaged.default;

async function main() {
  if (process.env.LANDIQ_PHASE1_BROWSER_DISPOSABLE !== "1") throw new Error("Explicit disposable browser opt-in is required");
  const infoFile = path.resolve(process.env.LANDIQ_BROWSER_INFO_FILE ?? "");
  if (path.dirname(infoFile) !== path.resolve(process.cwd(), "tmp") || !/^phase1-browser-[a-z0-9-]+\.json$/.test(path.basename(infoFile))) {
    throw new Error("Invalid fixture metadata path");
  }
  const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
  const ids = [info.financeOrderId, info.deliveryOrderId, info.courierOrderId, info.knownCourierOrderId];
  if (info.state !== "ready" || !Number.isInteger(info.webPort) || !Number.isInteger(info.pid)
    || ids.some((id) => typeof id !== "string" || !/^[a-z0-9]+$/.test(id)) || new Set(ids).size !== ids.length
    || !info.managerEmail?.endsWith("@fixture.invalid") || !info.viewerEmail?.endsWith("@fixture.invalid")) {
    throw new Error("Invalid browser fixture metadata");
  }
  process.kill(info.pid, 0);
  const command = fs.readFileSync(`/proc/${info.pid}/cmdline`, "utf8").split("\0");
  if (!command.some((part) => part.endsWith("tests/fixtures/phase1-browser-harness.cjs"))) throw new Error("Fixture harness process identity mismatch");
  const origin = `http://127.0.0.1:${info.webPort}`;
  const libs = await packaged.inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br"));
  packaged.setupLambdaEnvironment(path.join(libs, "lib"));
  const executablePath = await chromium.executablePath();
  const args = chromium.args.filter((arg) => !arg.startsWith("--disable-web-security") && !arg.startsWith("--allow-running-insecure-content"));
  const launch = () => playwright.launch({ executablePath, args, headless: true });
  const check = expect.configure({ timeout: 45_000 });
  let browser;
  async function role(email) {
    // The packaged Lambda shell is single-process: use a distinct process for
    // each login instead of relying on simultaneous browser contexts.
    if (browser) await browser.close();
    browser = await launch();
    const context = await browser.newContext({ baseURL: origin });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(info.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await check(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    return page;
  }
  async function openOrder(page, id) {
    await page.goto(`/dashboard/orders/${id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByRole("heading", { name: "Items & totals" })).toBeVisible();
  }
  async function row(page, name) {
    await page.goto("/dashboard/inventory", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    const match = page.locator("tr").filter({ hasText: name });
    await check(match).toHaveCount(1);
    return match;
  }
  async function balance(page, name, sellable, damaged) {
    const match = await row(page, name);
    await check(match.locator("td").nth(2)).toHaveText(String(sellable));
    await check(match.locator("td").nth(3)).toHaveText(String(damaged));
    return match;
  }
  const formFor = (page, name) => page.getByRole("button", { name, exact: true }).locator("xpath=ancestor::form");
  async function fields(form) {
    await check(form).toBeVisible();
    const entries = await form.evaluate((element) => [...new FormData(element).entries()]);
    if (!entries.some(([name]) => name.startsWith("$ACTION_ID_")) || entries.some(([, value]) => typeof value !== "string")) {
      throw new Error("Could not capture a valid synthetic server action");
    }
    return entries;
  }
  async function deny(page, url, entries) {
    const status = await page.evaluate(async ({ target, data }) => {
      const body = new FormData();
      for (const [name, value] of data) body.append(name, value);
      return (await fetch(target, { method: "POST", body, redirect: "manual" })).status;
    }, { target: url, data: entries });
    // Next dev currently turns a thrown ForbiddenError into 500; inspect the
    // fixture server log for FORBIDDEN and verify unchanged persisted state.
    expect([403, 500]).toContain(status);
  }
  const success = (page, text) => check(page.locator(".alert-success")).toContainText(text);
  const fail = (page, text) => check(page.locator(".alert-error")).toContainText(text);
  const rejectionEvidence = "Synthetic support case confirms this exact request was rejected";
  const bookingEvidence = "Synthetic support case reports this exact shipment and references";
  try {
    // Capture valid manager actions before the viewer attempts them. The same
    // fixture operations then succeed as manager, so failures are not merely
    // due to invalid form inputs or unmet workflow preconditions.
    let page = await role(info.managerEmail);
    await openOrder(page, info.financeOrderId);
    const note = formFor(page, "Save note");
    await note.locator('textarea[name="internalNote"]').fill("Synthetic authorized manager note");
    const noteFields = await fields(note);
    const collectFields = await fields(formFor(page, "Record COD collection"));

    await openOrder(page, info.deliveryOrderId);
    const assign = formFor(page, "Assign shop delivery");
    await assign.locator('select[name="personId"]').selectOption({ label: "Fixture Order Manager" });
    const assignFields = await fields(assign);

    await openOrder(page, info.courierOrderId);
    const rejected = formFor(page, "Record rejection report");
    await rejected.locator('select[name="environment"]').selectOption("sandbox");
    await rejected.locator('textarea[name="evidence"]').fill(rejectionEvidence);
    await rejected.locator('input[name="confirmOriginalAccount"]').check();
    await rejected.locator('input[name="confirmDefinitiveRejection"]').check();
    const rejectionFields = await fields(rejected);

    let adjustment = await balance(page, "Browser Adjustment Item", 1, 0);
    const adjustmentForm = adjustment.locator("form");
    await adjustmentForm.locator('input[name="stock"]').fill("3");
    await adjustmentForm.locator('input[name="reason"]').fill("Synthetic adjustment");
    const adjustmentFields = await fields(adjustmentForm);

    page = await role(info.viewerEmail);
    await openOrder(page, info.financeOrderId);
    await deny(page, `/dashboard/orders/${info.financeOrderId}`, noteFields);
    await deny(page, `/dashboard/orders/${info.financeOrderId}`, collectFields);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByText("No internal note.")).toBeVisible();
    await check(page.getByText("Payment: cod · COD_PENDING")).toBeVisible();
    await openOrder(page, info.deliveryOrderId);
    await deny(page, `/dashboard/orders/${info.deliveryOrderId}`, assignFields);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByText("No shop delivery person assigned.")).toBeVisible();
    await openOrder(page, info.courierOrderId);
    await deny(page, `/dashboard/orders/${info.courierOrderId}`, rejectionFields);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByText("Booking outcome unknown — do not retry")).toBeVisible();
    await check(page.getByText(/Staff reports a request-specific rejection/)).toHaveCount(0);
    await balance(page, "Browser Adjustment Item", 1, 0);
    await deny(page, "/dashboard/inventory", adjustmentFields);
    await balance(page, "Browser Adjustment Item", 1, 0);
    console.info("VIEWER: forged note, COD collection, shop assignment, courier rejection and inventory adjustment did not mutate fixture data");

    page = await role(info.managerEmail);
    await openOrder(page, info.financeOrderId);
    const managerNote = formFor(page, "Save note");
    await managerNote.locator('textarea[name="internalNote"]').fill("Synthetic authorized manager note");
    await managerNote.getByRole("button", { name: "Save note" }).click();
    await success(page, "Internal note saved");
    await check(page.locator('textarea[name="internalNote"]')).toHaveValue("Synthetic authorized manager note");
    await page.getByRole("button", { name: "Record COD collection", exact: true }).click();
    await success(page, "COD collection recorded");
    await check(page.getByText("Payment: cod · COD_COLLECTED")).toBeVisible();
    await check(page.getByText("Financial: PARTIALLY_SETTLED · Settlement: PENDING")).toBeVisible();
    // A hard navigation restores the server-rendered action fields after a
    // hydrated Next server-action redirect before capturing them for forgery.
    await openOrder(page, info.financeOrderId);
    const refund = formFor(page, "Record refund (no provider call)");
    await refund.locator('input[name="amount"]').fill("100");
    await refund.locator('input[name="reason"]').fill("Synthetic internal refund");
    await check(refund.locator('input[name="idempotencyKey"]')).not.toHaveValue("");
    const refundFields = await fields(refund);
    const settleFields = await fields(formFor(page, "Mark COD settled"));

    page = await role(info.viewerEmail);
    await openOrder(page, info.financeOrderId);
    await deny(page, `/dashboard/orders/${info.financeOrderId}`, settleFields);
    await deny(page, `/dashboard/orders/${info.financeOrderId}`, refundFields);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByText("Financial: PARTIALLY_SETTLED · Settlement: PENDING")).toBeVisible();
    await check(page.getByText(/INTERNAL refund/)).toHaveCount(0);
    console.info("VIEWER: forged COD settlement and valid internal refund did not mutate fixture data");

    page = await role(info.managerEmail);
    await openOrder(page, info.financeOrderId);
    await page.getByRole("button", { name: "Mark COD settled", exact: true }).click();
    await success(page, "COD settlement recorded");
    await check(page.getByText("Financial: SETTLED · Settlement: SETTLED")).toBeVisible();
    const managerRefund = formFor(page, "Record refund (no provider call)");
    await managerRefund.locator('input[name="amount"]').fill("100");
    await managerRefund.locator('input[name="reason"]').fill("Synthetic internal refund");
    await check(managerRefund.locator('input[name="idempotencyKey"]')).not.toHaveValue("");
    await managerRefund.getByRole("button", { name: "Record refund (no provider call)", exact: true }).click();
    await success(page, "Internal refund recorded (provider not contacted)");
    await check(page.getByText(/INTERNAL refund.*RECORDED/)).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await check(page.getByText(/INTERNAL refund.*RECORDED/)).toHaveCount(1);
    await check(page.locator('textarea[name="internalNote"]')).toHaveValue("Synthetic authorized manager note");
    adjustment = await balance(page, "Browser Adjustment Item", 1, 0);
    await adjustment.locator('input[name="stock"]').fill("3");
    await adjustment.locator('input[name="reason"]').fill("Synthetic adjustment");
    await adjustment.getByRole("button", { name: "Set", exact: true }).click();
    await success(page, "Stock adjusted");
    await balance(page, "Browser Adjustment Item", 3, 0);
    const adjustmentMovement = page.locator("div.border-b").filter({ hasText: "Browser Adjustment Item" })
      .filter({ has: page.locator("p").filter({ hasText: /^ADJUSTMENT · sellable/ }) });
    await check(adjustmentMovement).toHaveCount(1);
    await check(adjustmentMovement).toContainText("+2");
    console.info("ORDER_MANAGER: note, full COD collection/settlement, internal refund and sellable adjustment persisted");

    await openOrder(page, info.deliveryOrderId);
    const managerAssign = formFor(page, "Assign shop delivery");
    await managerAssign.locator('select[name="personId"]').selectOption({ label: "Fixture Order Manager" });
    await managerAssign.getByRole("button", { name: "Assign shop delivery" }).click();
    await success(page, "Shop delivery assigned");
    await check(page.getByText("Fixture Order Manager · ASSIGNED")).toBeVisible();
    async function deliveryEvent(status) {
      const form = formFor(page, "Record physical event");
      await form.locator('select[name="status"]').selectOption(status);
      await form.getByRole("button", { name: "Record physical event" }).click();
      await success(page, "Physical delivery event recorded; stock has not been returned");
      await check(page.getByText(`Fixture Order Manager · ${status.replaceAll("_", " ")}`)).toBeVisible();
    }
    await deliveryEvent("DISPATCHED");
    await deliveryEvent("RETURNING");
    await deliveryEvent("RETURNED");
    await balance(page, "Browser Delivery Item", 1, 0);
    await check(page.locator("div.border-b").filter({ hasText: "Browser Delivery Item" }).filter({ hasText: "RETURN" })).toHaveCount(0);
    console.info("ORDER_MANAGER: shop assignment, dispatch and reported return retained physical history without a warehouse stock credit");

    await openOrder(page, info.courierOrderId);
    await check(page.getByText("Booking outcome unknown — do not retry")).toBeVisible();
    const managerRejected = formFor(page, "Record rejection report");
    await managerRejected.locator('select[name="environment"]').selectOption("sandbox");
    await managerRejected.locator('textarea[name="evidence"]').fill(rejectionEvidence);
    await managerRejected.locator('input[name="confirmOriginalAccount"]').check();
    await managerRejected.locator('input[name="confirmDefinitiveRejection"]').check();
    await managerRejected.getByRole("button", { name: "Record rejection report" }).click();
    await success(page, "Staff-reported rejection recorded. The claim remains blocked and stock unchanged.");
    await check(page.getByText("fixture_courier · PENDING")).toBeVisible();
    await check(page.getByText(/Staff reports a request-specific rejection — not independently verified; claim remains blocked/)).toBeVisible();
    const blockedBooking = formFor(page, "Record staff-reported booking");
    await blockedBooking.locator('input[name="consignmentId"]').fill("synthetic-conflicting-consignment");
    await blockedBooking.locator('input[name="trackingId"]').fill("synthetic-conflicting-tracking");
    await blockedBooking.locator('select[name="environment"]').selectOption("sandbox");
    await blockedBooking.locator('textarea[name="evidence"]').fill(bookingEvidence);
    await blockedBooking.locator('input[name="confirmOriginalAccount"]').check();
    await blockedBooking.getByRole("button", { name: "Record staff-reported booking" }).click();
    await fail(page, "Staff-reported rejection conflicts with a booking report");
    await check(page.getByText("fixture_courier · PENDING")).toBeVisible();
    await check(page.getByText(/Consignment: — · Tracking: —/)).toBeVisible();
    await check(page.getByRole("button", { name: "Book shipment via API" })).toHaveCount(0);
    await balance(page, "Browser Courier Item", 1, 0);

    await openOrder(page, info.knownCourierOrderId);
    const known = formFor(page, "Record staff-reported booking");
    await known.locator('input[name="consignmentId"]').fill("synthetic-known-consignment");
    await known.locator('input[name="trackingId"]').fill("synthetic-known-tracking");
    await known.locator('select[name="environment"]').selectOption("sandbox");
    await known.locator('textarea[name="evidence"]').fill(bookingEvidence);
    await known.locator('input[name="confirmOriginalAccount"]').check();
    await known.getByRole("button", { name: "Record staff-reported booking" }).click();
    await success(page, "Staff booking evidence recorded; goods are not automatically returned");
    await check(page.getByText("fixture_courier · BOOKED")).toBeVisible();
    await check(page.getByText("Staff-recorded shipment reference — evidence supplied, not independently verified")).toBeVisible();
    await check(page.getByText(/Consignment: synthetic-known-consignment · Tracking: synthetic-known-tracking/)).toBeVisible();
    await balance(page, "Browser Known Courier Item", 1, 0);
    console.info("ORDER_MANAGER: reported rejection stayed pending and blocked; separate known-booking evidence was labelled staff-reported without provider calls");
    console.info(`Authorization and fulfillment browser smoke PASS; Chromium ${browser.version()}; JS test client only`);
  } finally { if (browser) await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
