import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import EmbeddedPostgres from "embedded-postgres";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Explicit opt-in: this suite NEVER uses DATABASE_URL, the old fixtures,
// migrations, db push, seed, truncation, or a live payment/courier provider.
// It creates its own cluster and database, verifies their identity before any
// SQL write, uses a CREATE-only test schema, and removes only its own scratch
// directory. A test client must support Prisma's pg driver adapter.
const enabled = process.env.LANDIQ_PHASE1_CLOSURE_DISPOSABLE_PG === "1";
const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
const mocks = vi.hoisted(() => ({ createShipment: vi.fn(), cancelShipment: vi.fn(), initialize: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, {
  get(_target, key) {
    if (!state.client) throw new Error("Disposable database identity has not been verified");
    const value: unknown = Reflect.get(state.client, key, state.client);
    return typeof value === "function" ? value.bind(state.client) : value;
  },
}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify, notifyOwners: mocks.notify }));
vi.mock("@/lib/marketing", () => ({ sendServerPurchaseEvent: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  assertPaymentMethodAvailable: async (code: string) => ({ name: code, sandbox: true }),
  calculateDeliveryCharge: async () => ({ charge: 0 }),
  getBusinessSettings: async () => ({ currency: "BDT" }),
  getPaymentCredential: async () => ({ synthetic: "fixture" }),
  getCourierCredentialFromSnapshot: async () => ({ synthetic: "fixture" }),
}));
vi.mock("@/lib/payments/registry", () => ({ getPaymentProvider: (code: string) => code === "fixture_online" ? {
  code, credentialsValid: () => true, initialize: mocks.initialize,
} : null }));
vi.mock("@/lib/couriers/registry", () => ({ getCourierProvider: (code: string) => code === "fixture_courier" ? {
  code, credentialsValid: () => true, createShipment: mocks.createShipment, cancelShipment: mocks.cancelShipment,
} : null }));

import { bookCourierShipment, cancelOrder, finalizeCourierBooking, placeOrder, updateOrderStatus, type PendingCourierClaim } from "@/services/orders";
import { recordCourierRejectionEvidence, reconcileCourierBooking, reconcileCourierCancellation, requestCourierCancellation } from "@/services/courier-operations";
import { assignOwnDelivery, recordOwnDeliveryEvent } from "@/services/own-delivery";
import { createProduct } from "@/services/products";
import { createReturnRequest, inspectReturnReceipt, receiveReturnItems, updateReturnStatus } from "@/services/returns";

let postgres: EmbeddedPostgres | undefined;
let scratch: string | undefined;
let started = false;
let sequence = 0;
const actor = "phase1-closure-fixture-actor";
const evidence = "Checked the synthetic original provider account and fixture support case 12345";

function db() {
  if (!state.client) throw new Error("Disposable database identity has not been verified");
  return state.client;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not select a port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
type Identity = { directory: string; database: string; username: string; port: number; host: string; schema: string };
async function identity(client: PrismaClient) {
  const [value] = await client.$queryRaw<Identity[]>`
    SELECT current_setting('data_directory') AS "directory", current_database()::text AS "database",
      current_user::text AS "username", inet_server_port() AS "port", host(inet_server_addr()) AS "host",
      current_schema()::text AS "schema"
  `;
  return value;
}
async function verify(client: PrismaClient, expected: { directory: string; database: string; username: string; port: number; host: string }) {
  const actual = await identity(client);
  if (!actual || await realpath(actual.directory) !== await realpath(expected.directory) || actual.database !== expected.database
    || actual.username !== expected.username || actual.port !== expected.port || actual.host !== expected.host || actual.schema !== "public") {
    throw new Error("Refusing SQL writes: disposable PostgreSQL identity does not match");
  }
  return actual;
}
async function product(stock: number, extraVariant = false) {
  return createProduct({ name: "Closure fixture", slug: `closure-${randomUUID()}`, regularPrice: 500, status: "PUBLISHED",
    variants: [{ name: "First", stock, attributes: [] }, ...(extraVariant ? [{ name: "Second", stock, attributes: [] }] : [])] }, actor);
}
function checkout(productId: string, variantId: string, options: { phone?: string; quantity?: number; key?: string; method?: string } = {}) {
  sequence++;
  return { productId, variantId, quantity: options.quantity ?? 1, paymentMethod: options.method ?? "cod", deliveryOption: "inside_city" as const,
    customer: { name: "Fixture Buyer", phone: options.phone ?? `017${String(sequence).padStart(8, "0")}`,
      address: "123 Fixture Street", district: "Rajshahi" }, ...(options.key ? { idempotencyKey: options.key } : {}) };
}
async function sale(stock = 2, quantity = 1) {
  const item = await product(stock);
  const result = await placeOrder(checkout(item.id, item.variants[0].id, { quantity }));
  return { product: item, variantId: item.variants[0].id, order: result.order };
}
async function balances(variantId: string) {
  return db().productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stock: true, damagedStock: true } });
}
async function ready(orderId: string) {
  await updateOrderStatus(orderId, "CONFIRMED", actor);
  await updateOrderStatus(orderId, "READY_TO_SHIP", actor);
}
async function shipped(orderId: string) {
  await updateOrderStatus(orderId, "CONFIRMED", actor);
  await updateOrderStatus(orderId, "PROCESSING", actor);
  await updateOrderStatus(orderId, "SHIPPED", actor);
}
async function approvedReturn(orderId: string) {
  const request = await createReturnRequest({ orderId, reason: "Fixture physical return" }, actor);
  await updateReturnStatus(request.id, "APPROVED", actor);
  const item = await db().orderItem.findFirstOrThrow({ where: { orderId } });
  return { request, item };
}

describe.skipIf(!enabled)("Phase 1 on a new identity-verified disposable PostgreSQL cluster", () => {
  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "tmp");
    await mkdir(root, { recursive: true });
    scratch = await mkdtemp(path.join(root, "phase1-closure-"));
    const directory = path.join(scratch, "data");
    const host = "127.0.0.1";
    const port = await freePort();
    const username = `closure_${randomBytes(10).toString("hex")}`;
    const password = randomBytes(32).toString("hex");
    const database = `closure_${randomBytes(10).toString("hex")}`;
    if (!/^closure_[a-f0-9]{20}$/.test(username) || !/^closure_[a-f0-9]{20}$/.test(database)) throw new Error("Invalid generated identity");
    postgres = new EmbeddedPostgres({ databaseDir: directory, port, user: username, password, persistent: false,
      autoRehydrateSymlinks: true, postgresFlags: ["-c", `listen_addresses=${host}`, "-c", `unix_socket_directories=${scratch}`],
      onLog: () => {}, onError: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    started = true;

    // Verify the spawned process and its own postmaster.pid before even making
    // the first identity query. This prevents a port collision from contacting
    // an unrelated listener; PostgreSQL can listen only after owning that port.
    const postmaster = (await readFile(path.join(directory, "postmaster.pid"), "utf8")).split("\n");
    const spawned = (postgres as unknown as { process?: { pid?: number } }).process?.pid;
    if (!spawned || Number(postmaster[0]) !== spawned || await realpath(postmaster[1]) !== await realpath(directory)
      || Number(postmaster[3]) !== port || postmaster[4] !== scratch || postmaster[5] !== host) {
      throw new Error("Refusing to connect: local PostgreSQL process identity mismatch");
    }
    const makeClient = (name: string) => new PrismaClient({ adapter: new PrismaPg({ host, port, user: username, password, database: name, ssl: false, max: 12 }) });
    const admin = makeClient("postgres");
    try {
      await verify(admin, { directory, database: "postgres", username, port, host });
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    } finally { await admin.$disconnect(); }
    const client = makeClient(database);
    try {
      const verified = await verify(client, { directory, database, username, port, host });
      const [empty] = await client.$queryRaw<Array<{ tables: bigint; types: bigint }>>`
        SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')) AS "tables",
          (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype IN ('e', 'c', 'd')) AS "types"
      `;
      if (Number(empty.tables) !== 0 || Number(empty.types) !== 0) throw new Error("Refusing fixture DDL: database is not empty");
      console.info("Verified disposable PostgreSQL identity", { host, port, database, username, schema: verified.schema, directory: verified.directory, pid: spawned });
      const fixture = await readFile(path.join(process.cwd(), "tests/fixtures/phase1-disposable-schema.sql"), "utf8");
      const statements = fixture.replace(/^--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean);
      if (!statements.length || statements.some((sql) => !/^CREATE\s+(?:TYPE|TABLE|(?:UNIQUE\s+)?INDEX)\s/i.test(sql))) {
        throw new Error("Refusing non-CREATE-only fixture SQL");
      }
      console.info("CREATE-only schema fixture SHA-256", createHash("sha256").update(fixture).digest("hex"));
      for (const statement of statements) await client.$executeRawUnsafe(statement);
      state.client = client;
    } catch (error) { await client.$disconnect(); throw error; }
    await db().user.create({ data: { id: actor, name: "Fixture staff", email: "phase1-closure@fixture.invalid", passwordHash: "not-a-login" } });
    await db().courierProviderConfiguration.create({ data: { code: "fixture_courier", name: "Synthetic courier", enabled: true, sandbox: true } });
  }, 90_000);

  afterAll(async () => {
    if (state.client) { await state.client.$disconnect(); state.client = null; }
    if (postgres && started) await postgres.stop();
    // scratch was produced by mkdtemp, not supplied by an environment variable.
    if (scratch && path.dirname(scratch) === path.resolve(process.cwd(), "tmp") && path.basename(scratch).startsWith("phase1-closure-")) {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notify.mockResolvedValue(undefined);
    mocks.createShipment.mockResolvedValue({ consignmentId: "synthetic-consignment", trackingId: "synthetic-tracking", raw: {} });
    mocks.cancelShipment.mockResolvedValue(true);
    mocks.initialize.mockImplementation(async ({ orderId }: { orderId: string }) => ({ reference: `fixture-${orderId}`,
      checkoutUrl: "https://fixture.invalid/pay", raw: {}, status: "INITIATED" }));
  });

  it("serializes legacy concurrent same-customer checkouts across variants", async () => {
    const item = await product(3, true); const phone = `018${String(++sequence).padStart(8, "0")}`;
    const results = await Promise.allSettled(item.variants.map((variant) => placeOrder(checkout(item.id, variant.id, { phone }))));
    expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((value) => value.status === "rejected")).toHaveLength(1);
    expect(await db().order.count({ where: { productId: item.id } })).toBe(1);
    expect((await db().productVariant.findMany({ where: { productId: item.id } })).reduce((sum, variant) => sum + variant.stock, 0)).toBe(5);
    expect(await db().stockMovement.count({ where: { productId: item.id, type: "SALE" } })).toBe(1);
  });

  it("awards the last unit to one competing customer without overselling", async () => {
    const item = await product(1); const variant = item.variants[0];
    const results = await Promise.allSettled([placeOrder(checkout(item.id, variant.id)), placeOrder(checkout(item.id, variant.id))]);
    expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((value) => value.status === "rejected")).toHaveLength(1);
    expect(await balances(variant.id)).toEqual({ stock: 0, damagedStock: 0 });
    expect(await db().stockMovement.count({ where: { productId: item.id, type: "SALE" } })).toBe(1);
  });

  it("replays a durable checkout key across races and beyond the old time window; different keys remain distinct", async () => {
    const item = await product(3); const key = randomUUID(); const input = checkout(item.id, item.variants[0].id, { key });
    const raced = await Promise.all([placeOrder(input), placeOrder(input), placeOrder(input)]);
    expect(new Set(raced.map((result) => result.order.id)).size).toBe(1);
    await db().order.update({ where: { id: raced[0].order.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    expect((await placeOrder(input)).order.id).toBe(raced[0].order.id);
    await expect(placeOrder({ ...input, quantity: 2 })).rejects.toThrow(/different details/);
    const distinct = await placeOrder({ ...input, idempotencyKey: randomUUID() });
    expect(distinct.order.id).not.toBe(raced[0].order.id);
    expect(await balances(item.variants[0].id)).toEqual({ stock: 1, damagedStock: 0 });
    expect(await db().stockMovement.count({ where: { productId: item.id, type: "SALE" } })).toBe(2);
  });

  it("keeps the checkout key and customer details out of the replay marker and fails closed if that marker is damaged", async () => {
    const item = await product(2); const key = randomUUID();
    const input = checkout(item.id, item.variants[0].id, { key });
    const result = await placeOrder(input);
    const audit = await db().auditLog.findFirstOrThrow({ where: { entity: "Order", entityId: result.order.id, action: "ORDER_PLACED" } });
    expect(result.order.id).not.toContain(key);
    expect(audit.after).toMatchObject({ checkoutFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const marker = JSON.stringify(audit.after);
    for (const secret of [key, input.customer.name, input.customer.phone, input.customer.address]) expect(marker).not.toContain(secret);
    expect((await placeOrder({ ...input, visitorId: "another-synthetic-visitor" })).order.id).toBe(result.order.id);
    await db().auditLog.update({ where: { id: audit.id }, data: { after: {} } });
    await expect(placeOrder(input)).rejects.toThrow(/different details or requires staff review/);
    expect(await db().order.count({ where: { productId: item.id } })).toBe(1);
    expect(await balances(item.variants[0].id)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("never repeats an online payment call while the first result is in flight or unknown", async () => {
    const item = await product(2); const entered = deferred(); const release = deferred();
    const input = checkout(item.id, item.variants[0].id, { key: randomUUID(), method: "fixture_online" });
    mocks.initialize.mockImplementationOnce(async () => { entered.resolve(); await release.promise;
      return { reference: "synthetic-reference", checkoutUrl: "https://fixture.invalid/pay", raw: {}, status: "INITIATED" }; });
    const first = placeOrder(input); await entered.promise;
    await expect(placeOrder(input)).rejects.toThrow(/unresolved payment session/);
    expect(mocks.initialize).toHaveBeenCalledOnce();
    release.resolve(); const completed = await first;
    expect((await placeOrder(input)).order.id).toBe(completed.order.id);
    expect((await placeOrder(input)).checkoutUrl).toBe("https://fixture.invalid/pay");
    expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(await balances(item.variants[0].id)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("retains an unknown online payment initiation without issuing another provider call", async () => {
    const item = await product(2); const input = checkout(item.id, item.variants[0].id, { key: randomUUID(), method: "fixture_online" });
    mocks.initialize.mockRejectedValueOnce(new Error("synthetic timeout"));
    await expect(placeOrder(input)).rejects.toThrow(/unresolved payment session/);
    await expect(placeOrder(input)).rejects.toThrow(/unresolved payment session/);
    expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(await db().order.count({ where: { productId: item.id } })).toBe(1);
    expect(await balances(item.variants[0].id)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("makes concurrent undispatched cancellation release stock and record a movement exactly once", async () => {
    const value = await sale();
    const results = await Promise.all([cancelOrder(value.order.id, actor, "Customer cancelled"), cancelOrder(value.order.id, actor, "Customer cancelled")]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    // stockReleased reports the durable outcome on both the first call and an
    // exact retry; changed identifies the single transaction that wrote it.
    expect(results.every((result) => result.stockReleased)).toBe(true);
    expect(await balances(value.variantId)).toEqual({ stock: 2, damagedStock: 0 });
    expect(await db().stockMovement.count({ where: { reference: value.order.id, type: "CANCELLATION" } })).toBe(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: value.order.id } })).cancellationStockReleasedAt).not.toBeNull();
  });

  it("rolls back cancellation if its actor cannot be recorded", async () => {
    const value = await sale();
    await expect(cancelOrder(value.order.id, "missing-disposable-fixture-actor", "Rollback test")).rejects.toThrow();
    expect((await db().order.findUniqueOrThrow({ where: { id: value.order.id } })).status).toBe("PENDING");
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
    expect(await db().stockMovement.count({ where: { reference: value.order.id, type: "CANCELLATION" } })).toBe(0);
    expect(await db().orderStatusHistory.count({ where: { orderId: value.order.id, toStatus: "CANCELLED" } })).toBe(0);
  });

  it("records cancellation but holds stock when historical sale evidence conflicts", async () => {
    const value = await sale();
    await db().stockMovement.create({ data: { productId: value.product.id, variantId: value.variantId, type: "SALE",
      quantity: -1, balanceAfter: 1, reference: value.order.id, reason: "Synthetic conflicting historic entry" } });
    await expect(updateOrderStatus(value.order.id, "CONFIRMED", actor)).rejects.toThrow(/sale movements/);
    expect(await cancelOrder(value.order.id, actor, "Conflicting historic sale")).toEqual({ changed: true, stockReleased: false });
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
    expect(await db().stockMovement.count({ where: { reference: value.order.id, type: "CANCELLATION" } })).toBe(0);
  });

  it("records partial receipts without stock, inspects each bucket once, and preserves partial order status", async () => {
    const value = await sale(3, 3); await shipped(value.order.id); const { request, item } = await approvedReturn(value.order.id);
    const input = { returnRequestId: request.id, orderItemId: item.id, quantity: 2, idempotencyKey: randomUUID() };
    const [receipt, retry] = await Promise.all([receiveReturnItems(input, actor), receiveReturnItems(input, actor)]);
    expect(receipt.id).toBe(retry.id);
    expect(await balances(value.variantId)).toEqual({ stock: 0, damagedStock: 0 });
    const inspection = { receiptId: receipt.id, sellableQuantity: 1, damagedQuantity: 1 };
    await Promise.all([inspectReturnReceipt(inspection, actor), inspectReturnReceipt(inspection, actor)]);
    await expect(inspectReturnReceipt({ ...inspection, sellableQuantity: 2, damagedQuantity: 0 }, actor)).rejects.toThrow(/already inspected/);
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 1 });
    const ledger = await db().stockMovement.findMany({ where: { returnReceiptId: receipt.id }, orderBy: { bucket: "asc" } });
    expect(ledger.map((row) => [row.bucket, row.quantity])).toEqual([["SELLABLE", 1], ["DAMAGED", 1]]);
    // Database-level constraints supplement, rather than replace, service locks.
    await expect(db().stockMovement.create({ data: { productId: value.product.id, variantId: value.variantId,
      type: "RETURN", bucket: "SELLABLE", quantity: 1, balanceAfter: 2, reference: value.order.id, returnReceiptId: receipt.id } })).rejects.toThrow();
    await expect(db().returnReceipt.update({ where: { id: receipt.id }, data: { damagedQuantity: 0 } })).rejects.toThrow();
    await expect(db().productVariant.update({ where: { id: value.variantId }, data: { damagedStock: -1 } })).rejects.toThrow();
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 1 });
    expect(await db().stockMovement.count({ where: { returnReceiptId: receipt.id } })).toBe(2);
    await updateReturnStatus(request.id, "INSPECTED", actor);
    await updateReturnStatus(request.id, "COMPLETED", actor);
    expect((await updateReturnStatus(request.id, "COMPLETED", actor)).status).toBe("COMPLETED");
    expect((await db().order.findUniqueOrThrow({ where: { id: value.order.id } })).status).toBe("SHIPPED");
    // An exact status retry must not mask later inconsistent ledger evidence.
    await db().stockMovement.update({ where: { id: ledger[0].id }, data: { quantity: 2 } });
    await expect(updateReturnStatus(request.id, "COMPLETED", actor)).rejects.toThrow(/incomplete or duplicated/);
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 1 });
  });

  it("records a physical inspection separately from an unresolved financial refund", async () => {
    const value = await sale(); await shipped(value.order.id); const { request, item } = await approvedReturn(value.order.id);
    await db().refund.create({ data: { orderId: value.order.id, amount: 100, reason: "Synthetic pending financial claim",
      mode: "PROVIDER", status: "AWAITING_PROVIDER" } });
    const receipt = await receiveReturnItems({ returnRequestId: request.id, orderItemId: item.id, quantity: 1, idempotencyKey: randomUUID() }, actor);
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
    await inspectReturnReceipt({ receiptId: receipt.id, sellableQuantity: 0, damagedQuantity: 1 }, actor);
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 1 });
    expect((await db().refund.findFirstOrThrow({ where: { orderId: value.order.id } })).status).toBe("AWAITING_PROVIDER");
  });

  it("refuses to validate or complete an ambiguous legacy return without receipt evidence", async () => {
    const value = await sale();
    await updateOrderStatus(value.order.id, "CONFIRMED", actor);
    await updateOrderStatus(value.order.id, "READY_TO_SHIP", actor);
    await updateOrderStatus(value.order.id, "SHIPPED", actor);
    const request = await createReturnRequest({ orderId: value.order.id, reason: "Historical fixture" }, actor);
    await db().returnRequest.update({ where: { id: request.id }, data: { status: "RESTOCKED" } });
    await db().stockMovement.create({ data: { productId: value.product.id, variantId: value.variantId, type: "RETURN",
      quantity: 2, balanceAfter: 3, reference: value.order.id, reason: "Synthetic inconsistent historical entry" } });
    await expect(updateReturnStatus(request.id, "RESTOCKED", actor)).rejects.toThrow(/ambiguous.*receipt evidence/i);
    await expect(updateReturnStatus(request.id, "COMPLETED", actor)).rejects.toThrow(/Record and inspect/);
    expect((await db().order.findUniqueOrThrow({ where: { id: value.order.id } })).status).toBe("SHIPPED");
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("caps concurrent partial receipts across different operation keys", async () => {
    const value = await sale(2, 2); await shipped(value.order.id); const { request, item } = await approvedReturn(value.order.id);
    const input = { returnRequestId: request.id, orderItemId: item.id, quantity: 2 };
    const results = await Promise.allSettled([
      receiveReturnItems({ ...input, idempotencyKey: randomUUID() }, actor),
      receiveReturnItems({ ...input, idempotencyKey: randomUUID() }, actor),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db().returnReceipt.count({ where: { orderId: value.order.id } })).toBe(1);
    expect(await balances(value.variantId)).toEqual({ stock: 0, damagedStock: 0 });
  });

  it("rolls back the inspection, sellable balance and ledger when the damaged balance cannot be credited", async () => {
    const value = await sale(2, 2); await shipped(value.order.id); const { request, item } = await approvedReturn(value.order.id);
    const receipt = await receiveReturnItems({ returnRequestId: request.id, orderItemId: item.id, quantity: 2, idempotencyKey: randomUUID() }, actor);
    await db().productVariant.update({ where: { id: value.variantId }, data: { damagedStock: 2_147_483_647 } });
    await expect(inspectReturnReceipt({ receiptId: receipt.id, sellableQuantity: 1, damagedQuantity: 1 }, actor)).rejects.toThrow(/too large/);
    expect(await balances(value.variantId)).toEqual({ stock: 0, damagedStock: 2_147_483_647 });
    expect((await db().returnReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).inspectedAt).toBeNull();
    expect(await db().stockMovement.count({ where: { returnReceiptId: receipt.id } })).toBe(0);
  });

  it("races booking with cancellation, recovers a known booking, and never restores stock for courier cancellation", async () => {
    const value = await sale(); await ready(value.order.id); const entered = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { entered.resolve(); await release.promise;
      return { consignmentId: "fixture-consignment", trackingId: "fixture-tracking", raw: {} }; });
    const booking = bookCourierShipment(value.order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    await entered.promise;
    const result = await cancelOrder(value.order.id, actor, "Customer cancelled");
    expect(result).toEqual({ changed: true, stockReleased: false });
    release.resolve(); expect(await booking).toEqual(expect.objectContaining({ message: expect.stringMatching(/order changed/) }));
    const shipment = await db().courierShipment.findFirstOrThrow({ where: { orderId: value.order.id } });
    expect(shipment.status).toBe("PENDING");
    await reconcileCourierBooking({ shipmentId: shipment.id, merchantReference: value.order.orderNumber,
      consignmentId: "fixture-consignment", trackingId: "fixture-tracking", sandbox: true, evidence, confirmOriginalAccount: true }, actor);
    const [first, second] = await Promise.all([requestCourierCancellation(shipment.id, actor), requestCourierCancellation(shipment.id, actor)]);
    expect(first.id).toBe(second.id); expect(mocks.cancelShipment).toHaveBeenCalledOnce();
    await reconcileCourierCancellation({ shipmentId: shipment.id, outcome: "CANCELLED", evidence, confirmOriginalAccount: true }, actor);
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
    expect(await db().stockMovement.count({ where: { reference: value.order.id, type: "CANCELLATION" } })).toBe(0);
    expect((await db().order.findUniqueOrThrow({ where: { id: value.order.id } })).status).toBe("CANCELLED");
  });

  it("retains a staff-reported rejection and a late contrary booking as conflicting evidence without retrying", async () => {
    const value = await sale(); await ready(value.order.id); const entered = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { entered.resolve(); await release.promise;
      return { consignmentId: "late-consignment", trackingId: "late-tracking", raw: { accepted: true } }; });
    const booking = bookCourierShipment(value.order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    await entered.promise;
    const shipment = await db().courierShipment.findFirstOrThrow({ where: { orderId: value.order.id } });
    const marker = (shipment.payload as unknown as { landiqBooking: { requestFingerprint: string; configurationMac: string;
      orderStatusAtClaim: PendingCourierClaim["orderStatusAtClaim"] } }).landiqBooking;
    const invocation = mocks.createShipment.mock.calls.at(-1)?.[0];
    if (!invocation) throw new Error("Mock courier was not invoked");
    const { credentials: _credentials, ...request } = invocation;
    void _credentials;
    const claim: PendingCourierClaim = { orderId: value.order.id, shipmentId: shipment.id, providerCode: shipment.providerCode,
      actorId: actor, orderStatusAtClaim: marker.orderStatusAtClaim, request,
      requestFingerprint: marker.requestFingerprint, configurationMac: marker.configurationMac };
    const report = { shipmentId: shipment.id, merchantReference: value.order.orderNumber, sandbox: true, evidence,
      confirmOriginalAccount: true as const, confirmDefinitiveRejection: true as const };
    await recordCourierRejectionEvidence(report, actor); await recordCourierRejectionEvidence(report, actor);
    expect(await db().courierTrackingEvent.count({ where: { shipmentId: shipment.id, source: "STAFF_RECONCILIATION" } })).toBe(1);
    await expect(bookCourierShipment(value.order.id, "fixture_courier", actor)).rejects.toThrow(/courier record/);
    release.resolve(); expect(await booking).toEqual(expect.objectContaining({ message: expect.stringMatching(/order changed/) }));
    const conflicting = await db().courierShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(conflicting.status).toBe("PENDING");
    expect(conflicting.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" },
      landiqStaffRejection: { kind: "STAFF_REPORTED_REJECTION", evidence },
      conflictingProviderResult: { consignmentId: "late-consignment", trackingId: "late-tracking" } });
    const late = { consignmentId: "late-consignment", trackingId: "late-tracking", raw: { accepted: true } };
    const another = { consignmentId: "another-consignment", trackingId: "another-tracking", raw: { accepted: true } };
    const eventCount = await db().courierTrackingEvent.count({ where: { shipmentId: shipment.id } });
    expect((await finalizeCourierBooking(claim, late)).safe).toBe(false);
    expect(await db().courierTrackingEvent.count({ where: { shipmentId: shipment.id } })).toBe(eventCount);
    expect((await finalizeCourierBooking(claim, another)).safe).toBe(false);
    expect((await finalizeCourierBooking(claim, another)).safe).toBe(false);
    expect(await db().courierTrackingEvent.count({ where: { shipmentId: shipment.id } })).toBe(eventCount + 1);
    expect((await db().courierShipment.findUniqueOrThrow({ where: { id: shipment.id } })).payload).toMatchObject({
      additionalProviderResults: [{ consignmentId: "another-consignment", trackingId: "another-tracking" }] });
    await expect(reconcileCourierBooking({ shipmentId: shipment.id, merchantReference: value.order.orderNumber,
      consignmentId: "late-consignment", trackingId: "late-tracking", sandbox: true, evidence, confirmOriginalAccount: true }, actor)).rejects.toThrow(/Multiple provider results/);
    expect(mocks.createShipment).toHaveBeenCalledOnce();
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("preserves staff-booking provenance when a different late provider response conflicts", async () => {
    const value = await sale(); await ready(value.order.id); const entered = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { entered.resolve(); await release.promise;
      return { consignmentId: "late-provider-parcel", trackingId: "late-provider-tracking", raw: { accepted: true } }; });
    const booking = bookCourierShipment(value.order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    await entered.promise;
    const shipment = await db().courierShipment.findFirstOrThrow({ where: { orderId: value.order.id } });
    try {
      await reconcileCourierBooking({ shipmentId: shipment.id, merchantReference: value.order.orderNumber,
        consignmentId: "staff-parcel", trackingId: "staff-tracking", sandbox: true, evidence, confirmOriginalAccount: true }, actor);
    } finally { release.resolve(); }
    expect(await booking).toEqual(expect.objectContaining({ message: expect.stringMatching(/order changed/) }));
    const result = await db().courierShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(result.status).toBe("PENDING");
    expect(result.consignmentId).toBe("staff-parcel"); expect(result.trackingId).toBe("staff-tracking");
    expect(result.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" },
      landiqStaffResolution: { kind: "BOOKING_RECORDED", actorId: actor },
      conflictingProviderResult: { consignmentId: "late-provider-parcel", trackingId: "late-provider-tracking" } });
    const staffEvent = await db().courierTrackingEvent.findFirstOrThrow({ where: { shipmentId: shipment.id, source: "STAFF_RECONCILIATION" } });
    expect(staffEvent.raw).toMatchObject({ evidence });
    expect(mocks.createShipment).toHaveBeenCalledOnce();
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("keeps pre-existing conflicting booking evidence even without a staff rejection marker", async () => {
    const value = await sale(); await ready(value.order.id); const entered = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { entered.resolve(); await release.promise;
      return { consignmentId: "late-parcel", trackingId: "late-tracking", raw: { accepted: true } }; });
    const booking = bookCourierShipment(value.order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    await entered.promise;
    const shipment = await db().courierShipment.findFirstOrThrow({ where: { orderId: value.order.id } });
    try {
      await db().courierShipment.update({ where: { id: shipment.id }, data: { payload: {
        ...(shipment.payload as Prisma.JsonObject), conflictingProviderResult: { consignmentId: "prior-parcel", trackingId: "prior-tracking" },
      } as Prisma.InputJsonObject } });
      await expect(recordCourierRejectionEvidence({ shipmentId: shipment.id, merchantReference: value.order.orderNumber,
        sandbox: true, evidence, confirmOriginalAccount: true, confirmDefinitiveRejection: true }, actor)).rejects.toThrow(/conflicting result/);
      await expect(reconcileCourierBooking({ shipmentId: shipment.id, merchantReference: value.order.orderNumber,
        consignmentId: "prior-parcel", trackingId: "prior-tracking", sandbox: true, evidence, confirmOriginalAccount: true }, actor)).rejects.toThrow(/Multiple provider results/);
    } finally { release.resolve(); }
    expect(await booking).toEqual(expect.objectContaining({ message: expect.stringMatching(/order changed/) }));
    const result = await db().courierShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(result.status).toBe("PENDING");
    expect(result.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" },
      conflictingProviderResult: { consignmentId: "prior-parcel" },
      additionalProviderResults: [{ consignmentId: "late-parcel", trackingId: "late-tracking" }] });
    expect(mocks.createShipment).toHaveBeenCalledOnce();
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("keeps malformed rejection evidence blocked and retains a late booking instead of overwriting it", async () => {
    const value = await sale(); await ready(value.order.id); const entered = deferred(); const release = deferred();
    mocks.createShipment.mockImplementationOnce(async () => { entered.resolve(); await release.promise;
      return { consignmentId: "malformed-late-parcel", trackingId: "malformed-late-tracking", raw: { accepted: true } }; });
    const booking = bookCourierShipment(value.order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    await entered.promise;
    const shipment = await db().courierShipment.findFirstOrThrow({ where: { orderId: value.order.id } });
    try {
      await db().courierShipment.update({ where: { id: shipment.id }, data: { payload: {
        ...(shipment.payload as Prisma.JsonObject), landiqStaffRejection: null,
      } as Prisma.InputJsonObject } });
      await expect(recordCourierRejectionEvidence({ shipmentId: shipment.id, merchantReference: value.order.orderNumber,
        sandbox: true, evidence, confirmOriginalAccount: true, confirmDefinitiveRejection: true }, actor)).rejects.toThrow(/exists or is malformed/);
      await expect(reconcileCourierBooking({ shipmentId: shipment.id, merchantReference: value.order.orderNumber,
        consignmentId: "malformed-late-parcel", trackingId: "malformed-late-tracking", sandbox: true, evidence,
        confirmOriginalAccount: true }, actor)).rejects.toThrow(/evidence is malformed/);
    } finally { release.resolve(); }
    expect(await booking).toEqual(expect.objectContaining({ message: expect.stringMatching(/order changed/) }));
    const result = await db().courierShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(result.status).toBe("PENDING");
    expect(result.payload).toMatchObject({ landiqStaffRejection: null, landiqBooking: { state: "RECONCILIATION_REQUIRED" },
      conflictingProviderResult: { consignmentId: "malformed-late-parcel", trackingId: "malformed-late-tracking" } });
    expect(mocks.createShipment).toHaveBeenCalledOnce();
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("does not duplicate the original booking report when it arrives again after a conflicting result", async () => {
    const value = await sale(); await ready(value.order.id); const entered = deferred(); const release = deferred();
    const first = { consignmentId: "first-parcel", trackingId: "first-tracking", raw: { accepted: "first" } };
    const second = { consignmentId: "second-parcel", trackingId: "second-tracking", raw: { accepted: "second" } };
    mocks.createShipment.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return first; });
    const booking = bookCourierShipment(value.order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    await entered.promise;
    const shipment = await db().courierShipment.findFirstOrThrow({ where: { orderId: value.order.id } });
    const marker = (shipment.payload as unknown as { landiqBooking: { requestFingerprint: string; configurationMac: string;
      orderStatusAtClaim: PendingCourierClaim["orderStatusAtClaim"] } }).landiqBooking;
    const invocation = mocks.createShipment.mock.calls.at(-1)?.[0];
    if (!invocation) { release.resolve(); throw new Error("Mock courier was not invoked"); }
    const { credentials: _credentials, ...request } = invocation;
    void _credentials;
    const claim: PendingCourierClaim = { orderId: value.order.id, shipmentId: shipment.id, providerCode: shipment.providerCode,
      actorId: actor, orderStatusAtClaim: marker.orderStatusAtClaim, request,
      requestFingerprint: marker.requestFingerprint, configurationMac: marker.configurationMac };
    let eventCount = 0;
    try {
      expect((await finalizeCourierBooking(claim, first)).safe).toBe(true);
      expect((await finalizeCourierBooking(claim, second)).safe).toBe(false);
      eventCount = await db().courierTrackingEvent.count({ where: { shipmentId: shipment.id } });
    } finally { release.resolve(); }
    expect(await booking).toEqual(expect.objectContaining({ message: expect.stringMatching(/order changed/) }));
    expect((await finalizeCourierBooking(claim, first)).safe).toBe(false);
    expect(await db().courierTrackingEvent.count({ where: { shipmentId: shipment.id } })).toBe(eventCount);
    const result = await db().courierShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(result.status).toBe("PENDING");
    expect(result.consignmentId).toBe("first-parcel");
    expect(result.payload).toMatchObject({ providerResponse: first.raw, conflictingProviderResult: { consignmentId: "second-parcel" } });
    expect((result.payload as Prisma.JsonObject).additionalProviderResults).toBeUndefined();
    expect(mocks.createShipment).toHaveBeenCalledOnce();
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("serializes shop assignment against third-party booking", async () => {
    const value = await sale(); await ready(value.order.id);
    const outcomes = await Promise.allSettled([
      assignOwnDelivery({ orderId: value.order.id, personId: actor }, actor),
      bookCourierShipment(value.order.id, "fixture_courier", actor),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const own = await db().ownDelivery.findUnique({ where: { orderId: value.order.id } });
    const shipments = await db().courierShipment.findMany({ where: { orderId: value.order.id } });
    expect(Number(Boolean(own)) + shipments.length).toBe(1);
    expect(mocks.createShipment).toHaveBeenCalledTimes(own ? 0 : 1);
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
  });

  it("does not both dispatch a parcel and release its stock when dispatch races cancellation", async () => {
    const value = await sale(); await ready(value.order.id);
    await assignOwnDelivery({ orderId: value.order.id, personId: actor }, actor);
    const [cancellation, dispatch] = await Promise.allSettled([
      cancelOrder(value.order.id, actor, "Concurrent cancellation"),
      recordOwnDeliveryEvent({ orderId: value.order.id, status: "DISPATCHED" }, actor),
    ]);
    expect(cancellation.status).toBe("fulfilled");
    const delivery = await db().ownDelivery.findUniqueOrThrow({ where: { orderId: value.order.id }, include: { events: true } });
    const balancesAfter = await balances(value.variantId);
    const releaseCount = await db().stockMovement.count({ where: { reference: value.order.id, type: "CANCELLATION" } });
    if (delivery.status === "DISPATCHED") {
      expect(dispatch.status).toBe("fulfilled");
      expect(balancesAfter).toEqual({ stock: 1, damagedStock: 0 });
      expect(releaseCount).toBe(0);
      expect(delivery.events.filter((event) => event.status === "DISPATCHED")).toHaveLength(1);
    } else {
      expect(delivery.status).toBe("CANCELLED");
      expect(dispatch.status).toBe("rejected");
      expect(balancesAfter).toEqual({ stock: 2, damagedStock: 0 });
      expect(releaseCount).toBe(1);
      expect(delivery.events.filter((event) => event.status === "DISPATCHED")).toHaveLength(0);
    }
    expect((await db().order.findUniqueOrThrow({ where: { id: value.order.id } })).status).toBe("CANCELLED");
  });

  it("keeps shop dispatch and return as physical history after cancellation without releasing stock", async () => {
    const value = await sale(); await ready(value.order.id);
    await assignOwnDelivery({ orderId: value.order.id, personId: actor }, actor);
    await recordOwnDeliveryEvent({ orderId: value.order.id, status: "DISPATCHED" }, actor);
    expect(await cancelOrder(value.order.id, actor, "Customer cancelled")).toEqual({ changed: true, stockReleased: false });
    await recordOwnDeliveryEvent({ orderId: value.order.id, status: "RETURNING" }, actor);
    await recordOwnDeliveryEvent({ orderId: value.order.id, status: "RETURNED" }, actor);
    expect(await balances(value.variantId)).toEqual({ stock: 1, damagedStock: 0 });
    expect((await db().order.findUniqueOrThrow({ where: { id: value.order.id } })).status).toBe("CANCELLED");
    const delivery = await db().ownDelivery.findUniqueOrThrow({ where: { orderId: value.order.id }, include: { events: { orderBy: { createdAt: "asc" } } } });
    expect(delivery.events.map((event) => event.status)).toEqual(["ASSIGNED", "DISPATCHED", "RETURNING", "RETURNED"]);
  });
});
