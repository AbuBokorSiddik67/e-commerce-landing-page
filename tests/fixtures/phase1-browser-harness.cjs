/*
 * Opt-in disposable browser harness. NEVER uses DATABASE_URL, old fixtures,
 * migrations, db push, seeds, or a live provider. It starts a fresh PostgreSQL
 * cluster and a development-only Next server using the Prisma JS test client
 * plus pg adapter; it does not verify a production/native build. Start with
 * LANDIQ_PHASE1_BROWSER_DISPOSABLE=1 and an unused LANDIQ_BROWSER_INFO_FILE
 * below the ignored tmp/ directory. Stop the process to remove its cluster.
 */
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const EmbeddedPostgres = require("embedded-postgres").default;
const { randomBytes, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require("node:fs/promises");
const { createServer } = require("node:net");
const path = require("node:path");
const bcrypt = require("bcryptjs");

if (process.env.LANDIQ_PHASE1_BROWSER_DISPOSABLE !== "1") throw new Error("Explicit disposable browser opt-in is required");
const root = path.resolve(process.cwd(), "tmp");
const infoFile = path.resolve(process.env.LANDIQ_BROWSER_INFO_FILE ?? "");
if (path.dirname(infoFile) !== root || !/^phase1-browser-[a-z0-9-]+\.json$/.test(path.basename(infoFile))) {
  throw new Error("Browser info file must be a new phase1-browser-*.json file directly under tmp/");
}
let scratch, postgres, client, next, infoCreated = false, cleaning = false;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No free port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
async function verify(db, expected) {
  const [actual] = await db.$queryRaw`
    SELECT current_setting('data_directory') AS "directory", current_database()::text AS "database",
      current_user::text AS "username", inet_server_port() AS "port", host(inet_server_addr()) AS "host",
      current_schema()::text AS "schema"
  `;
  if (!actual || await realpath(actual.directory) !== await realpath(expected.directory)
    || actual.database !== expected.database || actual.username !== expected.username
    || actual.port !== expected.port || actual.host !== expected.host || actual.schema !== "public") {
    throw new Error("Refusing browser fixture writes: database identity mismatch");
  }
  return actual;
}
async function cleanup() {
  if (cleaning) return; cleaning = true;
  // Remove synthetic login credentials first, even if another process in the
  // group is terminated before PostgreSQL completes its shutdown.
  if (infoCreated) await rm(infoFile, { force: true });
  if (next && next.exitCode === null && next.signalCode === null) next.kill("SIGTERM");
  if (client) await client.$disconnect().catch(() => {});
  if (postgres?.process && postgres.process.exitCode === null && postgres.process.signalCode === null) await postgres.stop().catch(() => {});
  if (scratch && path.dirname(scratch) === root && path.basename(scratch).startsWith("phase1-browser-cluster-")) {
    await rm(scratch, { recursive: true, force: true });
  }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGUSR2"]) process.on(signal, () => { cleanup().then(() => process.exit(0)).catch(() => process.exit(1)); });

async function main() {
  await mkdir(root, { recursive: true });
  // Refuse to replace any existing metadata; cleanup only files created here.
  await writeFile(infoFile, JSON.stringify({ state: "starting", pid: process.pid }), { flag: "wx", mode: 0o600 });
  infoCreated = true;
  scratch = await mkdtemp(path.join(root, "phase1-browser-cluster-"));
  const directory = path.join(scratch, "data");
  const host = "127.0.0.1";
  const port = await freePort();
  const webPort = await freePort();
  const username = `browser_${randomBytes(10).toString("hex")}`;
  const password = randomBytes(32).toString("hex");
  const database = `browser_${randomBytes(10).toString("hex")}`;
  if (!/^browser_[a-f0-9]{20}$/.test(username) || !/^browser_[a-f0-9]{20}$/.test(database)) throw new Error("Invalid identity");
  postgres = new EmbeddedPostgres({ databaseDir: directory, port, user: username, password, persistent: false,
    autoRehydrateSymlinks: true, postgresFlags: ["-c", `listen_addresses=${host}`, "-c", `unix_socket_directories=${scratch}`],
    onLog: () => {}, onError: () => {},
  });
  await postgres.initialise(); await postgres.start();
  const pidFile = (await readFile(path.join(directory, "postmaster.pid"), "utf8")).split("\n");
  const pgPid = postgres.process?.pid;
  if (!pgPid || Number(pidFile[0]) !== pgPid || await realpath(pidFile[1]) !== await realpath(directory)
    || Number(pidFile[3]) !== port || pidFile[4] !== scratch || pidFile[5] !== host) throw new Error("Refusing to connect to unknown PostgreSQL process");
  const config = { host, port, user: username, password, database, ssl: false, max: 12 };
  const makeClient = (name) => new PrismaClient({ adapter: new PrismaPg({ ...config, database: name }) });
  const admin = makeClient("postgres");
  try { await verify(admin, { directory, database: "postgres", username, port, host }); await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`); }
  finally { await admin.$disconnect(); }
  client = makeClient(database);
  const verified = await verify(client, { directory, database, username, port, host });
  const [empty] = await client.$queryRaw`
    SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')) AS "tables",
      (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype IN ('e', 'c', 'd')) AS "types"
  `;
  if (Number(empty.tables) || Number(empty.types)) throw new Error("Refusing browser fixture: database is not empty");
  console.info("Browser disposable database verified", { database, username, host, port, directory: verified.directory, pid: pgPid });
  const fixture = await readFile(path.join(process.cwd(), "tests/fixtures/phase1-disposable-schema.sql"), "utf8");
  const statements = fixture.replace(/^--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean);
  if (!statements.length || statements.some((sql) => !/^CREATE\s+(?:TYPE|TABLE|(?:UNIQUE\s+)?INDEX)\s/i.test(sql))) throw new Error("Fixture is not CREATE-only");
  for (const sql of statements) await client.$executeRawUnsafe(sql);

  const managerRole = await client.role.create({ data: { key: "ORDER_MANAGER", name: "Fixture order manager" } });
  const storeManagerRole = await client.role.create({ data: { key: "MANAGER", name: "Fixture store manager" } });
  const viewerRole = await client.role.create({ data: { key: "VIEWER", name: "Fixture viewer" } });
  const userPassword = `Browser-${randomBytes(12).toString("hex")}!`;
  const passwordHash = await bcrypt.hash(userPassword, 10);
  const manager = await client.user.create({ data: { name: "Fixture Order Manager", email: "browser-manager@fixture.invalid",
    passwordHash, roles: { create: { roleId: managerRole.id } } } });
  await client.user.create({ data: { name: "Fixture Store Manager", email: "browser-store-manager@fixture.invalid",
    passwordHash, roles: { create: { roleId: storeManagerRole.id } } } });
  await client.user.create({ data: { name: "Fixture Viewer", email: "browser-viewer@fixture.invalid",
    passwordHash, roles: { create: { roleId: viewerRole.id } } } });
  await client.businessSetting.create({ data: { name: "Disposable Browser Store" } });
  const product = await client.product.create({ data: { name: "Browser Fixture Item", slug: `browser-${randomUUID()}`,
    regularPrice: 500, status: "PUBLISHED", variants: { create: { name: "Fixture variant", stock: 1, attributes: [] } } }, include: { variants: true } });
  const variant = product.variants[0];
  const customer = await client.customer.create({ data: { name: "Browser Fixture Buyer", phone: "01799112233" } });
  const order = await client.order.create({ data: { orderNumber: `BROWSER-${randomBytes(4).toString("hex")}`,
    customerId: customer.id, productId: product.id, variantId: variant.id, quantity: 2,
    subtotal: 1000, total: 1000, currency: "BDT", status: "SHIPPED", shippedAt: new Date(), paymentMethod: "cod", paymentStatus: "COD_PENDING",
    address: "123 Browser Fixture Street", district: "Rajshahi", trackingToken: randomBytes(24).toString("hex"),
    items: { create: { variantId: variant.id, name: product.name, unitPrice: 500, quantity: 2, lineTotal: 1000, attributes: [] } } } });
  await client.stockMovement.createMany({ data: [
    { productId: product.id, variantId: variant.id, type: "PURCHASE", quantity: 3, balanceAfter: 3, reason: "Fixture initial stock", createdById: manager.id },
    { productId: product.id, variantId: variant.id, type: "SALE", quantity: -2, balanceAfter: 1, reason: "Fixture order", reference: order.id },
  ] });
  await client.returnRequest.create({ data: { orderId: order.id, productId: product.id, status: "APPROVED", reason: "Browser fixture physical return" } });

  // A separate two-unit product exercises a real public COD checkout and a
  // lost response without changing the dashboard-return fixture above.
  await client.paymentMethodConfiguration.create({ data: { code: "cod", name: "Cash on delivery", enabled: true, visible: true, isDefault: true } });
  const checkoutSlug = `browser-checkout-${randomUUID()}`;
  const checkoutProduct = await client.product.create({ data: { name: "Checkout Browser Item", slug: checkoutSlug,
    regularPrice: 500, status: "PUBLISHED", variants: { create: { name: "Checkout variant", stock: 2, attributes: [] } },
    landingPage: { create: { slug: checkoutSlug, title: "Disposable checkout", status: "PUBLISHED",
      sections: { create: { type: "order_form", data: { title: "Place your order" }, position: 0 } } } } }, include: { variants: true } });
  await client.stockMovement.create({ data: { productId: checkoutProduct.id, variantId: checkoutProduct.variants[0].id,
    type: "PURCHASE", quantity: 2, balanceAfter: 2, reason: "Fixture checkout opening stock", createdById: manager.id } });
  // This published landing has no sections, exercising the storefront's safe
  // fallback form and a separate customer cancellation without altering other fixtures.
  const cancelSlug = `browser-cancel-${randomUUID()}`;
  const cancelProduct = await client.product.create({ data: { name: "Browser Cancellation Item", slug: cancelSlug,
    regularPrice: 350, status: "PUBLISHED", variants: { create: { name: "Cancellation variant", stock: 2, attributes: [] } },
    landingPage: { create: { slug: cancelSlug, title: "Disposable cancellation", status: "PUBLISHED" } } }, include: { variants: true } });
  await client.stockMovement.create({ data: { productId: cancelProduct.id, variantId: cancelProduct.variants[0].id,
    type: "PURCHASE", quantity: 2, balanceAfter: 2, reason: "Fixture cancellation opening stock", createdById: manager.id } });

  async function fulfillmentFixture(name) {
    const item = await client.product.create({ data: { name, slug: `browser-fulfillment-${randomUUID()}`,
      regularPrice: 500, status: "PUBLISHED", variants: { create: { name: "Fulfillment variant", stock: 1, attributes: [] } } }, include: { variants: true } });
    const itemVariant = item.variants[0];
    const sale = await client.order.create({ data: { orderNumber: `BROWSER-${randomBytes(4).toString("hex")}`,
      customerId: customer.id, productId: item.id, variantId: itemVariant.id, quantity: 1, subtotal: 500, total: 500,
      currency: "BDT", status: "READY_TO_SHIP", paymentMethod: "cod", paymentStatus: "COD_PENDING",
      address: "123 Browser Fixture Street", district: "Rajshahi", trackingToken: randomBytes(24).toString("hex"),
      items: { create: { variantId: itemVariant.id, name, unitPrice: 500, quantity: 1, lineTotal: 500, attributes: [] } } } });
    await client.stockMovement.createMany({ data: [
      { productId: item.id, variantId: itemVariant.id, type: "PURCHASE", quantity: 2, balanceAfter: 2, reason: "Fixture initial stock", createdById: manager.id },
      { productId: item.id, variantId: itemVariant.id, type: "SALE", quantity: -1, balanceAfter: 1, reason: "Fixture order", reference: sale.id },
    ] });
    return sale;
  }
  const deliveryOrder = await fulfillmentFixture("Browser Delivery Item");
  const financeOrder = await fulfillmentFixture("Browser Finance Item");
  const courierOrder = await fulfillmentFixture("Browser Courier Item");
  const knownCourierOrder = await fulfillmentFixture("Browser Known Courier Item");
  // Synthetic unresolved claims; no courier adapter or provider is invoked.
  for (const candidate of [courierOrder, knownCourierOrder]) await client.courierShipment.create({ data: {
    orderId: candidate.id, providerCode: "fixture_courier", status: "PENDING", codAmount: 500,
    payload: { landiqBooking: { version: 4, state: "OUTCOME_UNKNOWN", sandbox: true, merchantReference: candidate.orderNumber,
      orderStatusAtClaim: "READY_TO_SHIP", requestFingerprint: "a".repeat(64), configurationMac: "b".repeat(64) } } } });
  const adjustmentProduct = await client.product.create({ data: { name: "Browser Adjustment Item", slug: `browser-adjustment-${randomUUID()}`,
    regularPrice: 500, status: "PUBLISHED", variants: { create: { name: "Adjustment variant", stock: 1, attributes: [] } } }, include: { variants: true } });
  await client.stockMovement.create({ data: { productId: adjustmentProduct.id, variantId: adjustmentProduct.variants[0].id,
    type: "PURCHASE", quantity: 1, balanceAfter: 1, reason: "Fixture adjustment opening stock", createdById: manager.id } });

  // The preload replaces only the Prisma constructor in this child process.
  // It checks the owned postgres.pid again and never reads DATABASE_URL.
  const privateConfig = path.join(scratch, "browser-private.json");
  await writeFile(privateConfig, JSON.stringify({ config, directory, pgPid, scratch }), { flag: "wx", mode: 0o600 });
  const preload = path.join(scratch, "browser-preload.cjs");
  await writeFile(preload, `
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const data=JSON.parse(fs.readFileSync(${JSON.stringify(privateConfig)},'utf8'));
const p=fs.readFileSync(path.join(data.directory,'postmaster.pid'),'utf8').split('\\n');
if(Number(p[0])!==data.pgPid||fs.realpathSync(p[1])!==fs.realpathSync(data.directory)||Number(p[3])!==data.config.port||p[4]!==data.scratch||p[5]!==data.config.host)throw new Error('Browser database process identity mismatch');
process.kill(data.pgPid,0);const original=Module._load;let patched;
Module._load=function(request,parent,isMain){const result=original.apply(this,arguments);if(request!=='@prisma/client')return result;
 if(!patched){const {PrismaPg}=original.call(this,'@prisma/adapter-pg',parent,isMain);const Base=result.PrismaClient;
 class DisposablePrismaClient extends Base{constructor(options){super({...options,adapter:new PrismaPg(data.config)})}};
 patched={...result,PrismaClient:DisposablePrismaClient}}return patched};
`, { flag: "wx", mode: 0o600 });
  const env = { ...process.env, DATABASE_URL: "postgresql://invalid:invalid@invalid:1/invalid", NODE_OPTIONS: `--require=${preload}`,
    CREDENTIALS_ENCRYPTION_KEY: "fixture-only-browser-key", NEXT_TELEMETRY_DISABLED: "1", LANDIQ_PREVIEW_EMBED: "1",
    SMTP_HOST: "", SMTP_FROM: "", SMS_API_URL: "", SMS_API_TOKEN: "", META_CAPI_ACCESS_TOKEN: "",
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${webPort}` };
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "-H", "0.0.0.0", "-p", String(webPort)], { env, stdio: "inherit" });
  next.on("exit", (code, signal) => { if (!cleaning) { console.error("Disposable Next server exited", { code, signal }); cleanup().then(() => process.exit(1)); } });
  await writeFile(infoFile, JSON.stringify({ state: "ready", pid: process.pid, webPort, orderId: order.id,
    checkoutSlug, checkoutProductId: checkoutProduct.id, checkoutVariantId: checkoutProduct.variants[0].id,
    cancelSlug, cancelProductId: cancelProduct.id, cancelVariantId: cancelProduct.variants[0].id,
    deliveryOrderId: deliveryOrder.id, financeOrderId: financeOrder.id, courierOrderId: courierOrder.id, knownCourierOrderId: knownCourierOrder.id,
    managerEmail: "browser-manager@fixture.invalid", storeManagerEmail: "browser-store-manager@fixture.invalid", viewerEmail: "browser-viewer@fixture.invalid", password: userPassword }), { mode: 0o600 });
  console.info(`Disposable browser fixture starting on port ${webPort}; credentials stay in the ignored test metadata file.`);
}
main().catch(async (error) => { console.error(error); await cleanup(); process.exitCode = 1; });
