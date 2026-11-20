import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Opt-in only. No DATABASE_URL, existing cluster, migration, seed, reset helper,
// or existing table is used. All application Prisma access is replaced by the
// client for a newly created cluster and a uniquely named test database.
const enabled = process.env.LANDIQ_INVENTORY_DISPOSABLE_PG_TEST === "1";
const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
const mocks = vi.hoisted(() => ({
  initialize: vi.fn(), verify: vi.fn(), refund: vi.fn(), getPaymentCredential: vi.fn(), getCourierCredential: vi.fn(),
  getCourierCredentialFromSnapshot: vi.fn(), createShipment: vi.fn(), notify: vi.fn(), notifyOwners: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, {
  get(_target, key) {
    if (!state.client) throw new Error("Disposable test database is not initialized");
    const value: unknown = Reflect.get(state.client, key, state.client);
    return typeof value === "function" ? value.bind(state.client) : value;
  },
}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify, notifyOwners: mocks.notifyOwners }));
vi.mock("@/lib/marketing", () => ({ sendServerPurchaseEvent: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  assertPaymentMethodAvailable: vi.fn(async (code: string) => ({ name: code, sandbox: true })),
  calculateDeliveryCharge: vi.fn(async () => ({ charge: 0 })),
  getBusinessSettings: vi.fn(async () => ({ currency: "BDT" })),
  getPaymentCredential: mocks.getPaymentCredential, getCourierCredential: mocks.getCourierCredential,
  getCourierCredentialFromSnapshot: mocks.getCourierCredentialFromSnapshot,
}));
vi.mock("@/lib/payments/registry", () => ({ getPaymentProvider: (code: string) => code === "sslcommerz" ? {
  code, name: "Fixture payment provider", credentialsValid: () => true,
  initialize: mocks.initialize, verify: mocks.verify, refund: mocks.refund,
} : null }));
vi.mock("@/lib/couriers/registry", () => ({ getCourierProvider: (code: string) => code === "fixture_courier" ? {
  code, credentialsValid: () => true, createShipment: mocks.createShipment,
} : null }));

import { assignManualCourier, bookCourierShipment, cancelOrder, collectCod, expireEligibleReservations, finalizeCourierBooking, placeOrder, processPaymentCallback, settleCod, syncCourierTracking, updateOrderStatus, type PendingCourierClaim } from "@/services/orders";
// Byte-for-byte snapshot of the repository's pre-upgrade writer, not a model.
import { bookCourierShipment as legacyBookCourierShipment, cancelOrder as legacyCancelOrder } from "../fixtures/legacy-f151222/orders";
import { createReturnRequest, executeProviderRefund, recordRefund, updateReturnStatus } from "@/services/returns";
import { createProduct, setProductStatus, updateProduct } from "@/services/products";
import { adjustStock, setStock } from "@/services/inventory";

let postgres: EmbeddedPostgres | undefined;
let scratch: string | undefined;
let started = false;
let sequence = 0;
let workerConnection: { host: string; port: number; user: string; password: string; database: string; directory: string } | undefined;
const actor = "phase1-fixture-actor";

function db() {
  if (!state.client) throw new Error("Disposable test database is not initialized");
  return state.client;
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not select a test port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForBlocked(fragment: string, count = 1) {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    const rows = await db().$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}
    `;
    if (Number(rows[0]?.count ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${count} blocked query(s) containing ${fragment}`);
}

async function fixtureProduct(stock: number, status: "DRAFT" | "PUBLISHED" = "PUBLISHED") {
  return createProduct({ name: "Fixture item", slug: `item-${randomUUID()}`, regularPrice: 500, status,
    variants: [{ name: "Default", stock, attributes: [{ name: "Size", value: "M" }] }] }, actor);
}

function checkout(productId: string, variantId: string, method = "cod") {
  sequence++;
  return { productId, variantId, quantity: 1, paymentMethod: method, deliveryOption: "inside_city" as const,
    customer: { name: "Fixture Buyer", phone: `017${String(sequence).padStart(8, "0")}`,
      address: "123 Fixture Street", district: "Rajshahi" } };
}

async function sale(stock = 2, method = "cod") {
  const product = await fixtureProduct(stock);
  const result = await placeOrder(checkout(product.id, product.variants[0].id, method));
  return { product, order: result.order, variantId: product.variants[0].id };
}

async function paidOnline() {
  const online = await sale(2, "sslcommerz");
  const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
  mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
  expect(await processPaymentCallback("sslcommerz", { tran_id: payment.reference })).toMatchObject({ ok: true });
  return { ...online, payment };
}

async function stock(variantId: string) {
  return (await db().productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;
}

async function movements(orderId: string, type: "CANCELLATION" | "RETURN" | "SALE") {
  return db().stockMovement.findMany({ where: { reference: orderId, type } });
}

async function readyForCourier(orderId: string) {
  await updateOrderStatus(orderId, "CONFIRMED", actor);
  await updateOrderStatus(orderId, "READY_TO_SHIP", actor);
}

async function capturedClaim(orderId: string): Promise<PendingCourierClaim> {
  const shipment = await db().courierShipment.findFirstOrThrow({ where: { orderId } });
  const marker = (shipment.payload as unknown as { landiqBooking: {
    requestFingerprint: string; configurationMac: string; orderStatusAtClaim: PendingCourierClaim["orderStatusAtClaim"];
  } }).landiqBooking;
  const invocation = mocks.createShipment.mock.calls.at(-1)?.[0];
  if (!invocation) throw new Error("Mock courier was not invoked");
  const { credentials: _credentials, ...request } = invocation;
  void _credentials;
  return { orderId, shipmentId: shipment.id, providerCode: shipment.providerCode, actorId: actor,
    orderStatusAtClaim: marker.orderStatusAtClaim, request, requestFingerprint: marker.requestFingerprint,
    configurationMac: marker.configurationMac };
}

async function ship(orderId: string) {
  await updateOrderStatus(orderId, "CONFIRMED", actor);
  await updateOrderStatus(orderId, "PROCESSING", actor);
  await updateOrderStatus(orderId, "SHIPPED", actor);
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

describe.skipIf(!enabled)("inventory and order integrity on a verified disposable PostgreSQL cluster (partial schema)", () => {
  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "tmp");
    await mkdir(root, { recursive: true });
    scratch = await mkdtemp(path.join(root, "phase1-postgres-"));
    const directory = path.join(scratch, "data");
    const port = await freePort();
    const user = `fixture_${randomBytes(8).toString("hex")}`;
    const password = randomBytes(24).toString("hex");
    const database = `phase1_${randomBytes(8).toString("hex")}`;
    const host = "127.0.0.1";
    postgres = new EmbeddedPostgres({ databaseDir: directory, port, user, password, persistent: false,
      autoRehydrateSymlinks: true,
      postgresFlags: ["-c", `listen_addresses=${host}`, "-c", `unix_socket_directories=${scratch}`],
      onLog: () => {}, onError: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    started = true;
    const makeClient = (name: string) => new PrismaClient({ adapter: new PrismaPg({ host, port, user, password, database: name, ssl: false, max: 12 }) });
    const admin = makeClient("postgres");
    try {
      const initial = await identity(admin);
      if (!initial || await realpath(initial.directory) !== await realpath(directory) || initial.database !== "postgres"
        || initial.username !== user || initial.port !== port || initial.host !== host || initial.schema !== "public") {
        throw new Error("Refusing to create a test database on an unverified cluster");
      }
      if (!/^phase1_[a-f0-9]{16}$/.test(database)) throw new Error("Invalid generated database name");
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    } finally {
      await admin.$disconnect();
    }
    state.client = makeClient(database);
    const verified = await identity(db());
    if (!verified || await realpath(verified.directory) !== await realpath(directory) || verified.database !== database
      || verified.username !== user || verified.port !== port || verified.host !== host || verified.schema !== "public") {
      throw new Error("Refusing fixture DDL and writes: database identity mismatch");
    }
    console.info("Verified disposable PostgreSQL identity", { host, port, database, schema: verified.schema, user, directory: verified.directory });
    workerConnection = { host, port, user, password, database, directory: verified.directory };
    const fixture = await readFile(path.join(process.cwd(), "tests/fixtures/inventory-order-disposable-schema.sql"), "utf8");
    for (const statement of fixture.replace(/^--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean)) {
      await db().$executeRawUnsafe(statement);
    }
    await db().$executeRaw`INSERT INTO "User" ("id") VALUES (${actor})`;
    await db().paymentMethodConfiguration.create({ data: { code: "sslcommerz", name: "Fixture", enabled: true, visible: true } });
    await db().courierProviderConfiguration.create({ data: { code: "fixture_courier", name: "Fixture Courier", enabled: true } });
    // Synthetic credentials only; the child worker intercepts every fetch.
    await db().courierProviderConfiguration.create({ data: { code: "steadfast", name: "Crash fixture", enabled: true,
      credentials: { apiKey: "fixture-key", apiSecret: "fixture-secret" } } });
  }, 90_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initialize.mockImplementation(async ({ orderId }: { orderId: string }) => ({
      reference: `reference-${orderId}`, checkoutUrl: "https://fixture.invalid/pay", raw: {}, status: "INITIATED",
    }));
    mocks.verify.mockImplementation(async (payload: Record<string, unknown>) => ({
      // Synthetic provider evidence: no current real adapter asserts this flag.
      status: "FAILED", terminalFailureVerified: true, reference: String(payload.tran_id), raw: { tran_id: payload.tran_id, status: "FAILED" },
    }));
    mocks.getPaymentCredential.mockReset().mockResolvedValue({});
    mocks.getCourierCredential.mockReset().mockResolvedValue({});
    mocks.getCourierCredentialFromSnapshot.mockReset().mockResolvedValue({});
    mocks.refund.mockReset();
    mocks.createShipment.mockReset();
    mocks.notify.mockResolvedValue(undefined);
    mocks.notifyOwners.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    try { await state.client?.$disconnect(); }
    finally {
      if (started) await postgres?.stop();
      // Only the mkdtemp-owned directory above is removed; never .postgres-data.
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("serializes duplicate cancellation and rolls status, stock, history, audit and release into one transaction", async () => {
    const { order, variantId } = await sale();
    const legacyReservation = await db().stockReservation.create({ data: { orderId: order.id, variantId, quantity: 1, expiresAt: new Date(0) } });
    expect(await stock(variantId)).toBe(1);
    const outcomes = await Promise.allSettled([cancelOrder(order.id, actor, "First"), cancelOrder(order.id, actor, "Second")]);
    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(await stock(variantId)).toBe(2);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect((await movements(order.id, "CANCELLATION")).map((movement) => movement.quantity)).toEqual([1]);
    expect(await db().orderStatusHistory.count({ where: { orderId: order.id, toStatus: "CANCELLED" } })).toBe(1);
    expect(await db().auditLog.count({ where: { entityId: order.id, action: "CANCEL_ORDER" } })).toBe(1);
    expect((await db().stockReservation.findUniqueOrThrow({ where: { id: legacyReservation.id } })).releasedAt).not.toBeNull();
  });

  it.each(["cancellation", "return"] as const)("uses a stable variant lock order for mixed-case legacy IDs during %s versus a product edit", async (operation) => {
    // PostgreSQL accepts imported IDs whose sort order differs between Unicode
    // codepoint comparison and localeCompare (unlike generated CUIDs).
    const suffix = randomUUID();
    const upperId = `A-${suffix}`;
    const lowerId = `a-${suffix}`;
    const product = await db().product.create({ data: { name: "Multi-variant fixture", slug: `multi-${suffix}`,
      regularPrice: 500, status: "PUBLISHED", variants: { create: [
        { id: upperId, name: "Upper", stock: 2, attributes: [] },
        { id: lowerId, name: "Lower", stock: 2, attributes: [] },
      ] } }, include: { variants: true } });
    await db().stockMovement.createMany({ data: product.variants.map((variant) => ({
      productId: product.id, variantId: variant.id, type: "PURCHASE" as const, quantity: 2, balanceAfter: 2,
    })) });
    const first = product.variants.find((variant) => variant.id === upperId)!;
    const second = product.variants.find((variant) => variant.id === lowerId)!;
    const placed = await placeOrder(checkout(product.id, first.id));
    await db().$transaction(async (tx) => {
      await tx.orderItem.create({ data: { orderId: placed.order.id, variantId: second.id, name: product.name,
        unitPrice: 500, quantity: 1, lineTotal: 500, attributes: [] } });
      await adjustStock(tx, { variantId: second.id, delta: -1, type: "SALE", reference: placed.order.id });
    });
    let returnId: string | undefined;
    if (operation === "return") {
      await ship(placed.order.id);
      const request = await createReturnRequest({ orderId: placed.order.id, reason: "Return multi-item order" }, actor);
      await updateReturnStatus(request.id, "APPROVED", actor);
      await updateReturnStatus(request.id, "INSPECTED", actor);
      returnId = request.id;
    }
    const snapshot = await db().product.findUniqueOrThrow({ where: { id: product.id }, include: {
      variants: { include: { _count: { select: { movements: true } } } },
    } });
    const editorInput = { name: snapshot.name, slug: snapshot.slug, regularPrice: snapshot.regularPrice,
      status: snapshot.status, expectedStatus: snapshot.status,
      variants: [...snapshot.variants].sort((a, b) => a.id < b.id ? 1 : -1).map((variant) => ({
        id: variant.id, name: variant.name, sku: variant.sku, price: variant.price, stock: variant.stock,
        expectedStock: variant.stock, expectedMovementCount: variant._count.movements,
        expectedUpdatedAt: variant.updatedAt.toISOString(), expectedAttributes: variant.attributes,
        isActive: variant.isActive, position: variant.position,
      })) };
    const locked = deferred();
    const release = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "id" = ${lowerId} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const restoration = (operation === "cancellation"
      ? cancelOrder(placed.order.id, actor, "Multi-item race")
      : updateReturnStatus(returnId!, "RESTOCKED", actor)).then(() => null, (error: unknown) => error);
    let editor: Promise<unknown> | undefined;
    try {
      await waitForBlocked('ProductVariant');
      editor = updateProduct(product.id, editorInput, actor).then(() => null, (error: unknown) => error);
      await waitForBlocked('ProductVariant', 2);
    } finally { release.resolve(); }
    await blocker;
    expect(await restoration).toBeNull();
    const editorOutcome = await editor;
    if (editorOutcome !== null) expect(editorOutcome).toEqual(expect.objectContaining({ message: expect.stringMatching(/changed.*Reload/) }));
    expect(await stock(first.id)).toBe(2);
    expect(await stock(second.id)).toBe(2);
    expect(await movements(placed.order.id, operation === "cancellation" ? "CANCELLATION" : "RETURN")).toHaveLength(2);
  }, 20_000);

  it.each(["ambiguous status", "unexpected payment record", "unexpected payment attempt", "financial state", "payment reference", "refund"] as const)("does not restore a COD order with %s", async (problem) => {
    const { order, variantId } = await sale();
    if (problem === "ambiguous status") await db().order.update({ where: { id: order.id }, data: { paymentStatus: "PENDING" } });
    if (problem === "unexpected payment record") await db().paymentTransaction.create({ data: { orderId: order.id,
      provider: "sslcommerz", reference: `unexpected-${order.id}`, status: "PAID", amount: order.total,
      currency: order.currency, verifiedAt: new Date() } });
    if (problem === "unexpected payment attempt") await db().paymentAttempt.create({ data: { orderId: order.id, provider: "sslcommerz", status: "INITIALIZING" } });
    if (problem === "financial state") await db().order.update({ where: { id: order.id }, data: { financialStatus: "PARTIALLY_SETTLED" } });
    if (problem === "payment reference") await db().order.update({ where: { id: order.id }, data: { paymentReference: "legacy-unknown" } });
    if (problem === "refund") await db().refund.create({ data: { orderId: order.id, amount: 100, reason: "Legacy refund" } });
    await expect(cancelOrder(order.id, actor, "Inconsistent COD evidence")).rejects.toThrow(/COD.*reconciliation/);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  });

  it.each(
    (["payment record", "payment attempt", "financial state", "payment reference", "settlement", "collection timestamp", "refund"] as const)
      .flatMap((problem) => (["fulfillment", "collection", "courier booking"] as const).map((operation) => ({ problem, operation }))),
  )("blocks COD $operation with conflicting $problem", async ({ problem, operation }) => {
    const { order, variantId } = await sale();
    if (operation === "courier booking") await readyForCourier(order.id);
    if (problem === "payment record") await db().paymentTransaction.create({ data: { orderId: order.id,
      provider: "sslcommerz", reference: `unexpected-${order.id}`, status: "PAID", amount: order.total,
      currency: order.currency, verifiedAt: new Date() } });
    if (problem === "payment attempt") await db().paymentAttempt.create({ data: { orderId: order.id, provider: "sslcommerz", status: "INITIALIZING" } });
    if (problem === "financial state") await db().order.update({ where: { id: order.id }, data: { financialStatus: "PARTIALLY_SETTLED" } });
    if (problem === "payment reference") await db().order.update({ where: { id: order.id }, data: { paymentReference: "legacy-unknown" } });
    if (problem === "settlement") await db().order.update({ where: { id: order.id }, data: { settlementStatus: "SETTLED" } });
    if (problem === "collection timestamp") await db().order.update({ where: { id: order.id }, data: { codCollectedAt: new Date() } });
    if (problem === "refund") await db().refund.create({ data: { orderId: order.id, amount: 100, reason: "Legacy refund" } });
    mocks.createShipment.mockResolvedValue({ consignmentId: "fixture-consignment", trackingId: "fixture-tracking", raw: {} });
    const action = operation === "fulfillment" ? updateOrderStatus(order.id, "CONFIRMED", actor)
      : operation === "collection" ? collectCod(order.id, order.total, actor)
      : bookCourierShipment(order.id, "fixture_courier", actor);
    await expect(action).rejects.toThrow(/COD.*reconciliation/);
    expect(mocks.createShipment).not.toHaveBeenCalled();
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("COD_PENDING");
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(0);
    expect(await stock(variantId)).toBe(1);
  });

  it.each(["shipped history", "cancelled history", "reopened shipped history", "shipped timestamp", "delivered timestamp", "cancelled timestamp", "rejected return"] as const)(
    "does not release or re-fulfill a pre-shipment order with conflicting %s", async (problem) => {
      const { order, variantId } = await sale();
      if (problem === "shipped history" || problem === "cancelled history") {
        await db().orderStatusHistory.create({ data: { orderId: order.id, toStatus: problem === "shipped history" ? "SHIPPED" : "CANCELLED", source: "LEGACY" } });
      }
      if (problem === "reopened shipped history") await db().orderStatusHistory.create({ data: {
        orderId: order.id, fromStatus: "SHIPPED", toStatus: "PENDING", source: "LEGACY" } });
      if (problem === "shipped timestamp") await db().order.update({ where: { id: order.id }, data: { shippedAt: new Date() } });
      if (problem === "delivered timestamp") await db().order.update({ where: { id: order.id }, data: { deliveredAt: new Date() } });
      if (problem === "cancelled timestamp") await db().order.update({ where: { id: order.id }, data: { cancelledAt: new Date() } });
      if (problem === "rejected return") await db().returnRequest.create({ data: { orderId: order.id, productId: order.productId,
        reason: "Legacy return", status: "REJECTED" } });
      await expect(cancelOrder(order.id, actor, "Inconsistent fulfillment history")).rejects.toThrow(/dispatch or return evidence/);
      await expect(updateOrderStatus(order.id, "CONFIRMED", actor)).rejects.toThrow(/dispatch or return evidence/);
      expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
      expect(await stock(variantId)).toBe(1);
      expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
    },
  );

  it("rolls cancellation back when recording a movement fails", async () => {
    const { order, variantId } = await sale();
    await expect(cancelOrder(order.id, "nonexistent-fixture-actor", "Failure test")).rejects.toThrow();
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
    expect(await db().orderStatusHistory.count({ where: { orderId: order.id, toStatus: "CANCELLED" } })).toBe(0);
  });

  it.each(["missing", "wrong quantity", "wrong sign", "wrong product"] as const)("refuses cancellation, fulfillment and COD collection when the recorded sale is %s", async (problem) => {
    const { order, variantId } = await sale();
    const where = { reference: order.id, type: "SALE" as const };
    if (problem === "missing") await db().stockMovement.deleteMany({ where });
    if (problem === "wrong quantity") await db().stockMovement.updateMany({ where, data: { quantity: -2 } });
    if (problem === "wrong sign") await db().stockMovement.updateMany({ where, data: { quantity: 1 } });
    if (problem === "wrong product") {
      const other = await fixtureProduct(1);
      await db().stockMovement.updateMany({ where, data: { productId: other.id } });
    }
    await expect(cancelOrder(order.id, actor, "Inconsistent history")).rejects.toThrow(/sale movements/);
    await expect(updateOrderStatus(order.id, "CONFIRMED", actor)).rejects.toThrow(/sale movements/);
    await expect(collectCod(order.id, order.total, actor)).rejects.toThrow(/sale movements/);
    const current = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(current.status).toBe("PENDING");
    expect(current.paymentStatus).toBe("COD_PENDING");
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  });

  it("blocks an additional restoration when a legacy RELEASE movement already references the order", async () => {
    const { order, variantId } = await sale();
    // Model a historical release that actually restored stock, not a new app writer.
    await db().$transaction(async (tx) => {
      await tx.productVariant.update({ where: { id: variantId }, data: { stock: { increment: 1 } } });
      await tx.stockMovement.create({ data: { productId: order.productId, variantId, type: "RELEASE",
        reference: order.id, quantity: 1, balanceAfter: 2 } });
    });
    await expect(cancelOrder(order.id, actor, "Already released")).rejects.toThrow(/Prior stock activity/);
    await expect(updateOrderStatus(order.id, "CONFIRMED", actor)).rejects.toThrow(/prior stock restoration/);
    await expect(collectCod(order.id, order.total, actor)).rejects.toThrow(/prior stock activity/);
    expect(await stock(variantId)).toBe(2);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  });

  it("serializes whole-order return creation and concurrent restocks; forbids reopening and the generic bypass", async () => {
    const { order, variantId } = await sale();
    await expect(updateOrderStatus(order.id, "CANCELLED", actor)).rejects.toThrow(/cancellation or return/);
    await expect(updateOrderStatus(order.id, "RETURNED", actor)).rejects.toThrow(/cancellation or return/);
    await ship(order.id);
    const requests = await Promise.allSettled([
      createReturnRequest({ orderId: order.id, reason: "Unwanted item" }, actor),
      createReturnRequest({ orderId: order.id, reason: "Unwanted item" }, actor),
    ]);
    expect(requests.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(requests.filter((result) => result.status === "rejected")).toHaveLength(1);
    const request = await db().returnRequest.findFirstOrThrow({ where: { orderId: order.id } });
    await updateReturnStatus(request.id, "APPROVED", actor);
    await updateReturnStatus(request.id, "INSPECTED", actor);
    const outcomes = await Promise.allSettled([
      updateReturnStatus(request.id, "RESTOCKED", actor), updateReturnStatus(request.id, "RESTOCKED", actor),
    ]);
    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(await stock(variantId)).toBe(2);
    expect((await movements(order.id, "RETURN")).map((movement) => movement.quantity)).toEqual([1]);
    await expect(updateOrderStatus(order.id, "OUT_FOR_DELIVERY", actor)).rejects.toThrow(/return or prior stock restoration/);
    await expect(updateReturnStatus(request.id, "APPROVED", actor)).rejects.toThrow(/Cannot change return/);
    await updateReturnStatus(request.id, "COMPLETED", actor);
    await expect(createReturnRequest({ orderId: order.id, reason: "Again please" }, actor)).rejects.toThrow();
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RETURNED");
    expect(await db().orderStatusHistory.count({ where: { orderId: order.id, toStatus: "RETURNED" } })).toBe(1);
  });

  it("refuses to complete an inconsistent historical return rather than guessing restored quantities", async () => {
    const { order, variantId } = await sale();
    await ship(order.id);
    const request = await createReturnRequest({ orderId: order.id, reason: "Damaged item" }, actor);
    // Deliberately model a legacy inconsistency, only in this disposable DB.
    await db().returnRequest.update({ where: { id: request.id }, data: { status: "RESTOCKED" } });
    await db().stockMovement.create({ data: { productId: order.productId, variantId, type: "RETURN",
      reference: order.id, quantity: 2, balanceAfter: 3 } });
    await expect(updateReturnStatus(request.id, "RESTOCKED", actor)).rejects.toThrow(/ambiguous/);
    await expect(updateReturnStatus(request.id, "COMPLETED", actor)).rejects.toThrow(/Restock/);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SHIPPED");
    expect(await stock(variantId)).toBe(1);
  });

  it.each(["missing sale", "legacy release"] as const)("refuses to restock a return with %s", async (problem) => {
    const { order, variantId } = await sale();
    await ship(order.id);
    const request = await createReturnRequest({ orderId: order.id, reason: "Damaged item" }, actor);
    await updateReturnStatus(request.id, "APPROVED", actor);
    await updateReturnStatus(request.id, "INSPECTED", actor);
    if (problem === "missing sale") {
      await db().stockMovement.deleteMany({ where: { reference: order.id, type: "SALE" } });
    } else {
      await db().stockMovement.create({ data: { productId: order.productId, variantId, type: "RELEASE",
        reference: order.id, quantity: 1, balanceAfter: 2 } });
    }
    await expect(updateReturnStatus(request.id, "RESTOCKED", actor)).rejects.toThrow(/sale movements|prior stock restoration/);
    expect((await db().returnRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("INSPECTED");
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SHIPPED");
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "RETURN")).toHaveLength(0);
  });

  it("prevents overselling when two checkouts wait on the same real variant lock", async () => {
    const product = await fixtureProduct(1);
    const variantId = product.variants[0].id;
    const locked = deferred();
    const release = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "id" = ${variantId} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const first = placeOrder(checkout(product.id, variantId)).then((value) => ({ value }), (error: unknown) => ({ error }));
    const second = placeOrder(checkout(product.id, variantId)).then((value) => ({ value }), (error: unknown) => ({ error }));
    try { await waitForBlocked("ProductVariant", 2); } finally { release.resolve(); }
    await blocker;
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => "value" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toHaveLength(1);
    expect(await stock(variantId)).toBe(0);
    expect(await db().order.count({ where: { productId: product.id } })).toBe(1);
    expect(await db().stockMovement.count({ where: { variantId, type: "SALE" } })).toBe(1);
  }, 20_000);

  it.each(["product", "variant"] as const)("rejects checkout when a concurrent %s deactivation commits first", async (target) => {
    const product = await fixtureProduct(2);
    const variantId = product.variants[0].id;
    const locked = deferred();
    const release = deferred();
    const change = db().$transaction(async (tx) => {
      if (target === "product") await tx.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
      else await tx.productVariant.update({ where: { id: variantId }, data: { isActive: false } });
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const attempt = placeOrder(checkout(product.id, variantId)).then(() => null, (error: unknown) => error);
    try { await waitForBlocked(target === "product" ? "FOR SHARE" : "ProductVariant"); } finally { release.resolve(); }
    await change;
    expect(await attempt).toEqual(expect.objectContaining({ message: expect.stringMatching(/no longer available/) }));
    expect(await stock(variantId)).toBe(2);
    expect(await db().order.count({ where: { productId: product.id } })).toBe(0);
  }, 20_000);

  it("rejects checkout when a concurrent price update commits before its locked recheck", async () => {
    const product = await fixtureProduct(2);
    const variantId = product.variants[0].id;
    const locked = deferred();
    const release = deferred();
    const change = db().$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { regularPrice: 700 } });
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const attempt = placeOrder(checkout(product.id, variantId)).then(() => null, (error: unknown) => error);
    try { await waitForBlocked("FOR SHARE"); } finally { release.resolve(); }
    await change;
    expect(await attempt).toEqual(expect.objectContaining({ message: expect.stringMatching(/changed while placing/) }));
    expect(await stock(variantId)).toBe(2);
    expect(await db().order.count({ where: { productId: product.id } })).toBe(0);
  }, 20_000);

  it("records draft opening stock exactly once and never invents another on publication", async () => {
    const product = await fixtureProduct(4, "DRAFT");
    const variantId = product.variants[0].id;
    expect((await db().stockMovement.findMany({ where: { variantId, type: "PURCHASE" } })).map((m) => m.quantity)).toEqual([4]);
    await Promise.all([setProductStatus(product.id, "PUBLISHED", actor), setStock(variantId, 6, 4, 1, "Count", actor)]);
    await setProductStatus(product.id, "DRAFT", actor);
    await setProductStatus(product.id, "PUBLISHED", actor);
    expect((await db().stockMovement.findMany({ where: { variantId, type: "PURCHASE" } })).map((m) => m.quantity)).toEqual([4]);
    expect((await db().stockMovement.findMany({ where: { variantId, type: "ADJUSTMENT" } })).map((m) => m.quantity)).toEqual([2]);
    expect(await stock(variantId)).toBe(6);
  });

  it("retains stock and marks initialization unknown after an ambiguous provider timeout", async () => {
    const product = await fixtureProduct(2);
    mocks.initialize.mockRejectedValue(new Error("Fixture timeout"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(placeOrder(checkout(product.id, product.variants[0].id, "sslcommerz"))).rejects.toThrow(/staff reconciliation/);
    } finally {
      log.mockRestore();
    }
    const order = await db().order.findFirstOrThrow({ where: { productId: product.id } });
    const attempt = await db().paymentAttempt.findFirstOrThrow({ where: { orderId: order.id } });
    expect(attempt.status).toBe("INITIALIZATION_UNKNOWN");
    expect(await stock(product.variants[0].id)).toBe(1);
    await expect(cancelOrder(order.id, actor, "Timeout")).rejects.toThrow(/not proven failed/);
    await db().stockReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(0) } });
    await expireEligibleReservations(actor);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });

  it("expires an online hold when credential loading failed before any provider request was attempted", async () => {
    const product = await fixtureProduct(2);
    mocks.getPaymentCredential.mockRejectedValueOnce(new Error("Fixture credential lookup failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(placeOrder(checkout(product.id, product.variants[0].id, "sslcommerz"))).rejects.toThrow(/staff reconciliation/);
    } finally { log.mockRestore(); }
    expect(mocks.initialize).not.toHaveBeenCalled();
    const order = await db().order.findFirstOrThrow({ where: { productId: product.id } });
    expect((await db().paymentAttempt.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("INITIALIZATION_NOT_STARTED");
    expect(await db().paymentTransaction.count({ where: { orderId: order.id } })).toBe(0);
    expect(await stock(product.variants[0].id)).toBe(1);
    await db().stockReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(0) } });
    expect((await expireEligibleReservations(actor)).expired).toBe(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect(await stock(product.variants[0].id)).toBe(2);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(1);
    expect((await expireEligibleReservations(actor)).expired).toBe(0);
  });

  it.each([{ value: "true" }, { value: 1 }, { value: {} }, { value: [] }])("does not accept non-boolean terminal evidence $value as proof of session closure", async ({ value: terminalFailureVerified }) => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    mocks.verify.mockResolvedValue({ status: "FAILED", terminalFailureVerified, reference: payment.reference, raw: {} });
    expect(await processPaymentCallback("sslcommerz", { tran_id: payment.reference })).toMatchObject({ ok: false, requiresReconciliation: true });
    await expect(cancelOrder(online.order.id, actor, "Unverified terminal status")).rejects.toThrow(/not proven failed/);
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("INITIATED");
    expect(await stock(online.variantId)).toBe(1);
  });

  it("does not treat a failed payment attempt as proof that the provider session has closed", async () => {
    const online = await sale(2, "sslcommerz");
    await db().stockReservation.updateMany({ where: { orderId: online.order.id }, data: { expiresAt: new Date(0) } });
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    mocks.verify.mockResolvedValue({ status: "FAILED", reference: payment.reference, raw: {} });
    expect(await processPaymentCallback("sslcommerz", { tran_id: payment.reference })).toMatchObject({ ok: false, requiresReconciliation: true });
    expect((await expireEligibleReservations(actor)).expired).toBe(0);
    await expect(cancelOrder(online.order.id, actor, "Attempt failed")).rejects.toThrow(/not proven failed/);
    expect(await stock(online.variantId)).toBe(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).paymentStatus).toBe("PENDING");
  });

  it.each(["PENDING", "FAILED"] as const)("keeps a legacy FAILED transaction reserved with order payment status %s", async (paymentStatus) => {
    const online = await sale(2, "sslcommerz");
    await db().order.update({ where: { id: online.order.id }, data: { paymentStatus } });
    await db().paymentTransaction.updateMany({ where: { orderId: online.order.id }, data: { status: "FAILED" } });
    await db().paymentAttempt.updateMany({ where: { orderId: online.order.id }, data: { status: "FAILED" } });
    await db().stockReservation.updateMany({ where: { orderId: online.order.id }, data: { expiresAt: new Date(0) } });
    await expect(cancelOrder(online.order.id, actor, "Legacy failed attempt")).rejects.toThrow(/not proven failed/);
    expect((await expireEligibleReservations(actor)).expired).toBe(0);
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect((await db().stockReservation.findFirstOrThrow({ where: { orderId: online.order.id } })).releasedAt).toBeNull();
    expect(await stock(online.variantId)).toBe(1);
    expect(await movements(online.order.id, "CANCELLATION")).toHaveLength(0);
  });

  it.each([
    "financial state", "settlement", "payment reference", "COD timestamp", "refund", "verified transaction",
    "wrong amount", "wrong currency", "missing reference", "another provider attempt", "duplicate initialization",
    "missing initialization", "unknown attempt", "changed terminal reference",
  ] as const)("does not release a terminal online hold with conflicting %s", async (problem) => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    await processPaymentCallback("sslcommerz", { tran_id: payment.reference });
    if (problem === "financial state") await db().order.update({ where: { id: online.order.id }, data: { financialStatus: "PARTIALLY_SETTLED" } });
    if (problem === "settlement") await db().order.update({ where: { id: online.order.id }, data: { settlementStatus: "IN_PROGRESS" } });
    if (problem === "payment reference") await db().order.update({ where: { id: online.order.id }, data: { paymentReference: "other-reference" } });
    if (problem === "COD timestamp") await db().order.update({ where: { id: online.order.id }, data: { codCollectedAt: new Date() } });
    if (problem === "refund") await db().refund.create({ data: { orderId: online.order.id, amount: 100, reason: "Legacy refund" } });
    if (problem === "verified transaction") await db().paymentTransaction.update({ where: { id: payment.id }, data: { verifiedAt: new Date() } });
    if (problem === "wrong amount") await db().paymentTransaction.update({ where: { id: payment.id }, data: { amount: payment.amount + 1 } });
    if (problem === "wrong currency") await db().paymentTransaction.update({ where: { id: payment.id }, data: { currency: "USD" } });
    if (problem === "missing reference") await db().paymentTransaction.update({ where: { id: payment.id }, data: { reference: null } });
    if (problem === "changed terminal reference") await db().paymentTransaction.update({ where: { id: payment.id }, data: { reference: `different-${online.order.id}` } });
    if (problem === "another provider attempt") await db().paymentAttempt.create({ data: { orderId: online.order.id, provider: "other", status: "INITIATED" } });
    if (problem === "duplicate initialization") await db().paymentAttempt.create({ data: { orderId: online.order.id, provider: "sslcommerz", status: "INITIATED" } });
    if (problem === "missing initialization") await db().paymentAttempt.deleteMany({ where: { orderId: online.order.id, status: "INITIATED" } });
    if (problem === "unknown attempt") await db().paymentAttempt.create({ data: { orderId: online.order.id, provider: "sslcommerz", status: "VERIFICATION_MISMATCH" } });
    await expect(cancelOrder(online.order.id, actor, "Conflicting payment evidence")).rejects.toThrow(/reconciliation|not proven failed/);
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect(await stock(online.variantId)).toBe(1);
    expect(await movements(online.order.id, "CANCELLATION")).toHaveLength(0);
  });

  it.each(["financial state", "payment reference", "refund"] as const)("does not release an unstarted online hold with conflicting %s", async (problem) => {
    const product = await fixtureProduct(2);
    mocks.getPaymentCredential.mockRejectedValueOnce(new Error("Fixture credential lookup failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await expect(placeOrder(checkout(product.id, product.variants[0].id, "sslcommerz"))).rejects.toThrow(/staff reconciliation/); }
    finally { log.mockRestore(); }
    const order = await db().order.findFirstOrThrow({ where: { productId: product.id } });
    if (problem === "financial state") await db().order.update({ where: { id: order.id }, data: { financialStatus: "PARTIALLY_SETTLED" } });
    if (problem === "payment reference") await db().order.update({ where: { id: order.id }, data: { paymentReference: "legacy-reference" } });
    if (problem === "refund") await db().refund.create({ data: { orderId: order.id, amount: 100, reason: "Legacy refund" } });
    await expect(cancelOrder(order.id, actor, "Conflicting financial evidence")).rejects.toThrow(/reconciliation|not proven failed/);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await stock(product.variants[0].id)).toBe(1);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it.each(["missing", "wrong quantity", "already released"] as const)("does not release an unstarted online payment with a %s reservation", async (problem) => {
    const product = await fixtureProduct(2);
    mocks.getPaymentCredential.mockRejectedValueOnce(new Error("Fixture credential lookup failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(placeOrder(checkout(product.id, product.variants[0].id, "sslcommerz"))).rejects.toThrow(/staff reconciliation/);
    } finally { log.mockRestore(); }
    const order = await db().order.findFirstOrThrow({ where: { productId: product.id } });
    if (problem === "missing") await db().stockReservation.deleteMany({ where: { orderId: order.id } });
    if (problem === "wrong quantity") await db().stockReservation.updateMany({ where: { orderId: order.id }, data: { quantity: 2, expiresAt: new Date(0) } });
    if (problem === "already released") await db().stockReservation.updateMany({ where: { orderId: order.id }, data: { releasedAt: new Date(), expiresAt: new Date(0) } });
    await expect(cancelOrder(order.id, actor, "Unclear reservation")).rejects.toThrow(/reservation does not match/);
    const result = await expireEligibleReservations(actor);
    expect(result.expired).toBe(0);
    if (problem === "wrong quantity") expect(result.deferred).toBe(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await stock(product.variants[0].id)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
    // Do not allow an intentionally inconsistent due row to affect later batches.
    await db().stockReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date("2100-01-01T00:00:00Z") } });
  });

  it("defers a due terminal hold when refund evidence conflicts with release", async () => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    await processPaymentCallback("sslcommerz", { tran_id: payment.reference });
    await db().refund.create({ data: { orderId: online.order.id, amount: 100, reason: "Legacy refund" } });
    await db().stockReservation.updateMany({ where: { orderId: online.order.id }, data: { expiresAt: new Date(0) } });
    try {
      const result = await expireEligibleReservations(actor);
      expect(result.expired).toBe(0);
      expect(result.deferred).toBe(1);
      expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
      expect(await stock(online.variantId)).toBe(1);
      expect(await movements(online.order.id, "CANCELLATION")).toHaveLength(0);
    } finally {
      await db().stockReservation.updateMany({ where: { orderId: online.order.id }, data: { expiresAt: new Date("2100-01-01T00:00:00Z") } });
    }
  });

  it("never automatically expires COD or uncertain online payments; expires a provider-confirmed failure once", async () => {
    const cod = await sale();
    const codHold = await db().stockReservation.create({ data: { orderId: cod.order.id, variantId: cod.variantId, quantity: 1, expiresAt: new Date(0) } });
    const online = await sale(2, "sslcommerz");
    await db().stockReservation.updateMany({ where: { orderId: online.order.id }, data: { expiresAt: new Date(0) } });
    await expect(cancelOrder(online.order.id, actor, "Unknown payment")).rejects.toThrow(/not proven failed/);
    expect((await expireEligibleReservations(actor)).expired).toBe(0);
    expect((await db().stockReservation.findUniqueOrThrow({ where: { id: codHold.id } })).releasedAt).toBeNull();
    expect(await stock(online.variantId)).toBe(1);
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    await processPaymentCallback("sslcommerz", { tran_id: payment.reference });
    const expired = await Promise.all([expireEligibleReservations(actor), expireEligibleReservations(actor)]);
    expect(expired.reduce((sum, result) => sum + result.expired, 0)).toBe(1);
    expect(await stock(online.variantId)).toBe(2);
    expect(await movements(online.order.id, "CANCELLATION")).toHaveLength(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("CANCELLED");
    expect((await db().stockReservation.findFirstOrThrow({ where: { orderId: online.order.id } })).releasedAt).not.toBeNull();
  });

  it.each(["payment", "expiry"] as const)("serializes payment versus expiry with %s queued first", async (first) => {
    const online = await sale(2, "sslcommerz");
    await db().stockReservation.updateMany({ where: { orderId: online.order.id }, data: { expiresAt: new Date(0) } });
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    await processPaymentCallback("sslcommerz", { tran_id: payment.reference });
    mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
    const locked = deferred();
    const release = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${online.order.id} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const beginExpiry = () => expireEligibleReservations(actor).then((value) => ({ value }), (error: unknown) => ({ error }));
    const beginPayment = () => processPaymentCallback("sslcommerz", { tran_id: payment.reference }).then((value) => ({ value }), (error: unknown) => ({ error }));
    let expiry: ReturnType<typeof beginExpiry>;
    let callback: ReturnType<typeof beginPayment>;
    try {
      if (first === "payment") {
        callback = beginPayment();
        await waitForBlocked('FROM "Order"');
        expiry = beginExpiry();
      } else {
        expiry = beginExpiry();
        await waitForBlocked('FROM "Order"');
        callback = beginPayment();
      }
      await waitForBlocked('FROM "Order"', 2);
    } finally { release.resolve(); }
    await blocker;
    const [expired, paid] = await Promise.all([expiry!, callback!]);
    expect(expired).toHaveProperty("value");
    expect(paid).toHaveProperty("value");
    const current = await db().order.findUniqueOrThrow({ where: { id: online.order.id } });
    const finalPayment = await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
    expect(current.paymentStatus).toBe("PAID");
    if (first === "payment") {
      expect(current.status).toBe("CONFIRMED");
      expect(finalPayment.status).toBe("PAID");
      expect(await stock(online.variantId)).toBe(1);
      expect(await movements(online.order.id, "CANCELLATION")).toHaveLength(0);
    } else {
      expect(current.status).toBe("CANCELLED");
      expect(finalPayment.status).toBe("PAID_REQUIRES_RECONCILIATION");
      expect(await stock(online.variantId)).toBe(2);
      expect(await movements(online.order.id, "CANCELLATION")).toHaveLength(1);
    }
  }, 20_000);

  it.each(["PAID", "FAILED"] as const)("does not verify a %s callback against a different provider environment", async (status) => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    await db().paymentTransaction.update({ where: { id: payment.id }, data: { sandbox: false } });
    mocks.verify.mockResolvedValue({ status, terminalFailureVerified: status === "FAILED", reference: payment.reference,
      amount: payment.amount, currency: payment.currency, raw: {} });
    await expect(processPaymentCallback("sslcommerz", { tran_id: payment.reference })).rejects.toThrow(/environment/);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect(await stock(online.variantId)).toBe(1);
  });

  it.each(["amount", "environment"] as const)("rechecks the payment %s after provider verification returns", async (changed) => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    const entered = deferred();
    const release = deferred();
    mocks.verify.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return { status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} };
    });
    const callback = processPaymentCallback("sslcommerz", { tran_id: payment.reference }).then(() => null, (error: unknown) => error);
    await entered.promise;
    try {
      await db().$transaction(async (tx) => {
        if (changed === "amount") {
          await tx.order.update({ where: { id: online.order.id }, data: { total: payment.amount + 1 } });
          await tx.paymentTransaction.update({ where: { id: payment.id }, data: { amount: payment.amount + 1 } });
        } else await tx.paymentTransaction.update({ where: { id: payment.id }, data: { sandbox: false } });
      });
    } finally { release.resolve(); }
    expect(await callback).toEqual(expect.objectContaining({ message: expect.stringMatching(/Payment does not match/) }));
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("INITIATED");
    expect(await stock(online.variantId)).toBe(1);
  });

  it("does not turn an unrecognized provider response into a paid order", async () => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    mocks.verify.mockResolvedValue({ status: "UNKNOWN", reference: payment.reference, raw: {} });
    await expect(processPaymentCallback("sslcommerz", { tran_id: payment.reference })).rejects.toThrow(/unrecognized/);
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("INITIATED");
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).paymentStatus).toBe("PENDING");
    expect(await stock(online.variantId)).toBe(1);
  });

  it("does not replace a legacy authorization with a terminal failure", async () => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    await db().order.update({ where: { id: online.order.id }, data: { paymentStatus: "AUTHORIZED" } });
    await expect(processPaymentCallback("sslcommerz", { tran_id: payment.reference })).rejects.toThrow(/cannot be replaced/);
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).paymentStatus).toBe("AUTHORIZED");
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("INITIATED");
    await expect(cancelOrder(online.order.id, actor, "Authorization is unresolved")).rejects.toThrow();
    expect(await stock(online.variantId)).toBe(1);
  });

  it("refuses missing, zero or mismatched payment evidence while retaining the hold", async () => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    for (const evidence of [
      { amount: undefined, currency: "BDT" }, { amount: 0, currency: "BDT" },
      { amount: payment.amount + 1, currency: "BDT" }, { amount: payment.amount, currency: "USD" },
      { amount: payment.amount, currency: undefined },
    ]) {
      mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, ...evidence, raw: {} });
      await expect(processPaymentCallback("sslcommerz", { tran_id: payment.reference })).rejects.toThrow(/amount and currency/);
    }
    mocks.verify.mockResolvedValue({ status: "PAID", reference: "different-provider-reference", amount: payment.amount, currency: "BDT", raw: {} });
    await expect(processPaymentCallback("sslcommerz", { tran_id: payment.reference })).rejects.toThrow(/reference/);
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).verifiedAt).toBeNull();
    expect(await stock(online.variantId)).toBe(1);
  });

  it.each(["missing", "wrong quantity", "wrong variant", "already released"] as const)("keeps a verified payment in reconciliation when its reservation is %s", async (problem) => {
    const online = await sale(2, "sslcommerz");
    const where = { orderId: online.order.id };
    if (problem === "missing") await db().stockReservation.deleteMany({ where });
    if (problem === "wrong quantity") await db().stockReservation.updateMany({ where, data: { quantity: 2 } });
    if (problem === "wrong variant") {
      const other = await fixtureProduct(1);
      await db().stockReservation.updateMany({ where, data: { variantId: other.variants[0].id } });
    }
    if (problem === "already released") await db().stockReservation.updateMany({ where, data: { releasedAt: new Date() } });
    const payment = await db().paymentTransaction.findFirstOrThrow({ where });
    mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
    const result = await processPaymentCallback("sslcommerz", { tran_id: payment.reference });
    expect(result).toMatchObject({ ok: false, requiresReconciliation: true });
    const current = await db().order.findUniqueOrThrow({ where: { id: online.order.id } });
    expect(current.status).toBe("PENDING");
    expect(current.paymentStatus).toBe("PAID");
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID_REQUIRES_RECONCILIATION");
    await expect(updateOrderStatus(online.order.id, "CONFIRMED", actor)).rejects.toThrow(/verified payment and allocated stock/);
    expect(await stock(online.variantId)).toBe(1);
    expect(await movements(online.order.id, "CANCELLATION")).toHaveLength(0);
  });

  it("does not confirm a captured payment after a legacy stock release", async () => {
    const online = await sale(2, "sslcommerz");
    await db().$transaction(async (tx) => {
      await tx.productVariant.update({ where: { id: online.variantId }, data: { stock: { increment: 1 } } });
      await tx.stockMovement.create({ data: { productId: online.order.productId, variantId: online.variantId,
        type: "RELEASE", reference: online.order.id, quantity: 1, balanceAfter: 2 } });
    });
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
    expect(await processPaymentCallback("sslcommerz", { tran_id: payment.reference })).toMatchObject({ ok: false, requiresReconciliation: true });
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID_REQUIRES_RECONCILIATION");
    expect(await stock(online.variantId)).toBe(2);
  });

  it.each(["financial state", "payment reference", "refund", "another payment", "unknown attempt", "missing initialization"] as const)(
    "records a captured payment for reconciliation when there is conflicting %s", async (problem) => {
      const online = await sale(2, "sslcommerz");
      const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
      if (problem === "financial state") await db().order.update({ where: { id: online.order.id }, data: { financialStatus: "SETTLED" } });
      if (problem === "payment reference") await db().order.update({ where: { id: online.order.id }, data: { paymentReference: "legacy-reference" } });
      if (problem === "refund") await db().refund.create({ data: { orderId: online.order.id, amount: 100, reason: "Legacy refund" } });
      if (problem === "another payment") await db().paymentTransaction.create({ data: { orderId: online.order.id,
        provider: "other", reference: `other-${online.order.id}`, status: "INITIATED", amount: payment.amount, currency: payment.currency } });
      if (problem === "unknown attempt") await db().paymentAttempt.create({ data: { orderId: online.order.id, provider: "sslcommerz", status: "INITIALIZATION_UNKNOWN" } });
      if (problem === "missing initialization") await db().paymentAttempt.deleteMany({ where: { orderId: online.order.id, status: "INITIATED" } });
      mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
      expect(await processPaymentCallback("sslcommerz", { tran_id: payment.reference })).toMatchObject({ ok: false, requiresReconciliation: true });
      expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID_REQUIRES_RECONCILIATION");
      const current = await db().order.findUniqueOrThrow({ where: { id: online.order.id } });
      expect(current.status).toBe("PENDING");
      if (problem === "payment reference") expect(current.paymentReference).toBe("legacy-reference");
      expect((await db().stockReservation.findFirstOrThrow({ where: { orderId: online.order.id } })).releasedAt).toBeNull();
      expect(await stock(online.variantId)).toBe(1);
    },
  );

  it("records a captured payment for reconciliation when its sale movement is missing", async () => {
    const online = await sale(2, "sslcommerz");
    await db().stockMovement.deleteMany({ where: { reference: online.order.id, type: "SALE" } });
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
    expect(await processPaymentCallback("sslcommerz", { tran_id: payment.reference })).toMatchObject({ ok: false, requiresReconciliation: true });
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID_REQUIRES_RECONCILIATION");
    await expect(updateOrderStatus(online.order.id, "CONFIRMED", actor)).rejects.toThrow(/sale movements/);
    expect(await stock(online.variantId)).toBe(1);
  });

  it("does not manually fulfill an old paid-looking row whose transaction does not match the order total", async () => {
    const online = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    await db().paymentTransaction.update({ where: { id: payment.id }, data: { status: "PAID", verifiedAt: new Date(), amount: payment.amount + 1 } });
    await db().order.update({ where: { id: online.order.id }, data: { paymentStatus: "PAID", paymentReference: payment.reference } });
    await expect(updateOrderStatus(online.order.id, "CONFIRMED", actor)).rejects.toThrow(/verified payment and allocated stock/);
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect(await stock(online.variantId)).toBe(1);
  });

  it("records a late verified payment for reconciliation without reopening or consuming restored stock", async () => {
    const online = await sale(2, "sslcommerz");
    await db().stockReservation.updateMany({ where: { orderId: online.order.id }, data: { expiresAt: new Date(0) } });
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    await processPaymentCallback("sslcommerz", { tran_id: payment.reference });
    await expireEligibleReservations(actor);
    mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
    const result = await processPaymentCallback("sslcommerz", { tran_id: payment.reference });
    expect(result).toMatchObject({ ok: false, requiresReconciliation: true });
    const order = await db().order.findUniqueOrThrow({ where: { id: online.order.id } });
    expect(order.status).toBe("CANCELLED");
    expect(order.paymentStatus).toBe("PAID");
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID_REQUIRES_RECONCILIATION");
    expect(await stock(online.variantId)).toBe(2);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(1);
  });

  it("serializes shipping against cancellation, allowing only the winning transition", async () => {
    const { order, variantId } = await sale();
    await updateOrderStatus(order.id, "CONFIRMED", actor);
    await updateOrderStatus(order.id, "READY_TO_SHIP", actor);
    const locked = deferred();
    const release = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const cancellation = cancelOrder(order.id, actor, "Race").then(() => null, (error: unknown) => error);
    const shipping = updateOrderStatus(order.id, "SHIPPED", actor).then(() => null, (error: unknown) => error);
    try { await waitForBlocked('FROM "Order"', 2); } finally { release.resolve(); }
    await blocker;
    const results = await Promise.all([cancellation, shipping]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    const current = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    if (current.status === "CANCELLED") {
      expect(await stock(variantId)).toBe(2);
      expect(await movements(order.id, "CANCELLATION")).toHaveLength(1);
    } else {
      expect(current.status).toBe("SHIPPED");
      expect(await stock(variantId)).toBe(1);
      expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
    }
  }, 20_000);

  it("retains a valid full COD collection and settlement through fulfillment and booking", async () => {
    const { order, variantId } = await sale();
    const collected = await collectCod(order.id, order.total, actor);
    expect(collected).toMatchObject({ paymentStatus: "COD_COLLECTED", financialStatus: "PARTIALLY_SETTLED" });
    expect((await collectCod(order.id, order.total, actor)).codCollectedAt).toEqual(collected.codCollectedAt);
    const settled = await settleCod(order.id, actor);
    expect(settled).toMatchObject({ paymentStatus: "COD_COLLECTED", settlementStatus: "SETTLED", financialStatus: "SETTLED" });
    expect((await settleCod(order.id, actor)).codSettledAt).toEqual(settled.codSettledAt);
    await readyForCourier(order.id);
    mocks.createShipment.mockResolvedValue({ consignmentId: "fixture-consignment", trackingId: "fixture-tracking", raw: {} });
    const shipment = await bookCourierShipment(order.id, "fixture_courier", actor);
    expect(shipment.codAmount).toBe(0);
    expect(await stock(variantId)).toBe(1);
  });

  it("does not collect COD while a return is active or after the order is returned", async () => {
    const active = await sale();
    await ship(active.order.id);
    await createReturnRequest({ orderId: active.order.id, reason: "Damaged item" }, actor);
    await expect(collectCod(active.order.id, active.order.total, actor)).rejects.toThrow(/active return/);
    expect((await db().order.findUniqueOrThrow({ where: { id: active.order.id } })).paymentStatus).toBe("COD_PENDING");

    const returned = await sale();
    // Legacy closed row with no recorded restock; do not infer a new collection.
    await db().order.update({ where: { id: returned.order.id }, data: { status: "RETURNED" } });
    await expect(collectCod(returned.order.id, returned.order.total, actor)).rejects.toThrow(/closed order/);
    expect((await db().order.findUniqueOrThrow({ where: { id: returned.order.id } })).paymentStatus).toBe("COD_PENDING");
  });

  // These were originally failing safety assertions; keep the safe behavior
  // as the expectation rather than characterizing an unsafe outcome as success.
  it("rejects a manual shipment after cancellation restored stock", async () => {
    const { order, variantId } = await sale();
    await cancelOrder(order.id, actor, "Cancelled before dispatch");
    expect(await stock(variantId)).toBe(2);
    await expect(assignManualCourier({ orderId: order.id, courierName: "Fixture courier", status: "BOOKED" }, actor)).rejects.toThrow();
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("prevents stock restoration while a provider booking is in flight", async () => {
    const { order, variantId } = await sale();
    await updateOrderStatus(order.id, "CONFIRMED", actor);
    await updateOrderStatus(order.id, "READY_TO_SHIP", actor);
    const entered = deferred();
    const release = deferred();
    mocks.createShipment.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return { consignmentId: "fixture-consignment", trackingId: "fixture-tracking", raw: {} };
    });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor)
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await entered.promise;
    let cancellation: unknown;
    try {
      const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(claim.status).toBe("PENDING");
      expect(claim.payload).toMatchObject({ landiqBooking: { state: "AWAITING_RESULT", sandbox: true } });
      // Each of these must finish while the mocked network call is still held;
      // otherwise the implementation is holding the order lock across I/O.
      cancellation = await cancelOrder(order.id, actor, "Cancelled during courier booking").then(() => null, (error: unknown) => error);
      await expect(updateOrderStatus(order.id, "SHIPPED", actor)).rejects.toThrow(/unresolved/);
      await expect(collectCod(order.id, order.total, actor)).rejects.toThrow(/unresolved/);
      await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record/i);
      await expect(assignManualCourier({ orderId: order.id, courierName: "Another courier" }, actor)).rejects.toThrow(/courier record/i);
      expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); }
    const shipment = await booking;
    expect(shipment).toHaveProperty("value");
    expect(cancellation).toBeInstanceOf(Error);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).not.toBe("CANCELLED");
    expect((await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("BOOKED");
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  }, 20_000);

  it("makes an exact manual assignment retry idempotent and blocks cancellation once assigned", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const input = { orderId: order.id, courierName: "Fixture courier", consignmentId: "manual-1", trackingId: "manual-track",
      cost: 40, codAmount: order.total, status: "BOOKED", note: "Fixture note" };
    const [first, second] = await Promise.all([assignManualCourier(input, actor), assignManualCourier(input, actor)]);
    expect(second.id).toBe(first.id);
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db().courierTrackingEvent.count({ where: { shipmentId: first.id } })).toBe(1);
    expect(await db().auditLog.count({ where: { entityId: first.id, action: "MANUAL_COURIER_ASSIGN" } })).toBe(1);
    await expect(assignManualCourier({ ...input, courierName: "Different courier" }, actor)).rejects.toThrow(/courier record/i);
    await expect(cancelOrder(order.id, actor, "Already assigned")).rejects.toThrow(/courier record/i);
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  });

  it("rolls back manual shipment, tracking and fee if its actor cannot be recorded", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    await expect(assignManualCourier({ orderId: order.id, courierName: "Fixture courier", cost: 30 }, "missing-fixture-actor")).rejects.toThrow();
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(0);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).courierFee).toBe(0);
    await cancelOrder(order.id, actor, "No shipment was assigned");
    expect(await stock(variantId)).toBe(2);
  });

  it("rejects invalid manual courier status, fees and COD amounts before making a shipment", async () => {
    const { order } = await sale();
    await readyForCourier(order.id);
    await expect(assignManualCourier({ orderId: order.id, courierName: "Fixture", status: "PENDING" }, actor)).rejects.toThrow();
    await expect(assignManualCourier({ orderId: order.id, courierName: "Fixture", cost: -1 }, actor)).rejects.toThrow();
    await expect(assignManualCourier({ orderId: order.id, courierName: "Fixture", codAmount: order.total + 1 }, actor)).rejects.toThrow(/COD amount/);
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("allows an inspected physical return for a known manual shipment", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    await assignManualCourier({ orderId: order.id, courierName: "Fixture courier", status: "BOOKED" }, actor);
    await updateOrderStatus(order.id, "SHIPPED", actor);
    const request = await createReturnRequest({ orderId: order.id, reason: "Damaged item" }, actor);
    await updateReturnStatus(request.id, "APPROVED", actor);
    await updateReturnStatus(request.id, "INSPECTED", actor);
    await updateReturnStatus(request.id, "RESTOCKED", actor);
    expect(await stock(variantId)).toBe(2);
    expect(await movements(order.id, "RETURN")).toHaveLength(1);
  });

  it("does not call a courier if cancellation queued first wins the order lock", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const locked = deferred();
    const release = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const cancellation = cancelOrder(order.id, actor, "Cancellation queued first").then(() => null, (error: unknown) => error);
    await waitForBlocked('FROM "Order"');
    const booking = bookCourierShipment(order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    try { await waitForBlocked('FROM "Order"', 2); } finally { release.resolve(); }
    await blocker;
    expect(await cancellation).toBeNull();
    expect(await booking).toBeInstanceOf(Error);
    expect(mocks.createShipment).not.toHaveBeenCalled();
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(0);
    expect(await stock(variantId)).toBe(2);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(1);
  }, 20_000);

  it("records one provider booking, returns it on an exact retry and does not call the provider twice", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    mocks.createShipment.mockResolvedValue({ consignmentId: "consignment-1", trackingId: "tracking-1",
      trackingUrl: "https://fixture.invalid/tracking-1", cost: 45, raw: { nested: [null, { accepted: true }] } });
    const first = await bookCourierShipment(order.id, "fixture_courier", actor);
    const retry = await bookCourierShipment(order.id, "fixture_courier", actor);
    expect(first.id).toBe(retry.id);
    expect(first.status).toBe("BOOKED");
    expect(first.payload).toMatchObject({ landiqBooking: { state: "BOOKED", sandbox: true }, providerResponse: { nested: [null, { accepted: true }] } });
    expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    expect(mocks.createShipment.mock.calls[0][0].codAmount).toBe(order.total);
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db().auditLog.count({ where: { entityId: first.id, action: "COURIER_BOOKED" } })).toBe(1);
    await expect(cancelOrder(order.id, actor, "Already booked")).rejects.toThrow(/courier record/i);
    expect(await stock(variantId)).toBe(1);
  });

  it.each([1, 2, 3])("does not retry an older version-%s booking marker even with copied fields", async (version) => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    mocks.createShipment.mockResolvedValue({ consignmentId: "old-consignment", trackingId: "old-tracking", raw: {} });
    const shipment = await bookCourierShipment(order.id, "fixture_courier", actor);
    const marker = (shipment.payload as unknown as { landiqBooking: Record<string, string | number | boolean> }).landiqBooking;
    await db().courierShipment.update({ where: { id: shipment.id }, data: { payload: { landiqBooking: { ...marker, version } } } });
    await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record.*reconciliation/i);
    await expect(cancelOrder(order.id, actor, "Legacy marker")).rejects.toThrow(/courier record/i);
    expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    expect(await stock(variantId)).toBe(1);
  });

  it.each(["delivery address", "customer name", "customer email", "product name", "product weight", "item attributes", "COD collection"] as const)(
    "does not treat changed %s as an exact courier booking retry", async (changed) => {
      const { order, variantId } = await sale();
      await readyForCourier(order.id);
      mocks.createShipment.mockResolvedValue({ consignmentId: "original-consignment", trackingId: "original-tracking", raw: {} });
      await bookCourierShipment(order.id, "fixture_courier", actor);
      if (changed === "delivery address") await db().order.update({ where: { id: order.id }, data: { address: "Updated address" } });
      if (changed === "customer name") await db().customer.update({ where: { id: order.customerId }, data: { name: "Updated Buyer" } });
      if (changed === "customer email") await db().customer.update({ where: { id: order.customerId }, data: { email: "changed@fixture.invalid" } });
      if (changed === "product name") await db().product.update({ where: { id: order.productId }, data: { name: "Changed product" } });
      if (changed === "product weight") await db().product.update({ where: { id: order.productId }, data: { weightGrams: 1500 } });
      if (changed === "item attributes") await db().orderItem.updateMany({ where: { orderId: order.id }, data: { attributes: [{ name: "Size", value: "XL" }] } });
      if (changed === "COD collection") await collectCod(order.id, order.total, actor);
      await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record.*reconciliation/i);
      expect(mocks.createShipment).toHaveBeenCalledTimes(1);
      expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(1);
      expect(await stock(variantId)).toBe(1);
    },
  );

  it("does not mistake a changed paid-online total for the same zero-COD courier request", async () => {
    const { order, payment, variantId } = await paidOnline();
    await updateOrderStatus(order.id, "READY_TO_SHIP", actor);
    mocks.createShipment.mockResolvedValue({ consignmentId: "online-c", trackingId: "online-t", raw: {} });
    await bookCourierShipment(order.id, "fixture_courier", actor);
    await db().$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { total: order.total + 1 } });
      await tx.paymentTransaction.update({ where: { id: payment.id }, data: { amount: payment.amount + 1 } });
    });
    await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record.*reconciliation/i);
    expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    expect(await stock(variantId)).toBe(1);
  });

  it("does not ask the courier to collect COD that was already recorded as collected", async () => {
    const { order } = await sale();
    await readyForCourier(order.id);
    await collectCod(order.id, order.total, actor);
    mocks.createShipment.mockResolvedValue({ consignmentId: "consignment-2", trackingId: "tracking-2", raw: {} });
    const shipment = await bookCourierShipment(order.id, "fixture_courier", actor);
    expect(shipment.codAmount).toBe(0);
    expect(mocks.createShipment.mock.calls[0][0].codAmount).toBe(0);
  });

  it("does not leave a claim or call a provider when credentials fail before booking starts", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    mocks.getCourierCredentialFromSnapshot.mockRejectedValueOnce(new Error("fixture credential lookup failed"));
    await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/credential lookup/);
    expect(mocks.createShipment).not.toHaveBeenCalled();
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(0);
    await cancelOrder(order.id, actor, "No provider request was started");
    expect(await stock(variantId)).toBe(2);
  });

  it("does not ship an order whose sale evidence was removed or an unpaid online order", async () => {
    const missing = await sale();
    await readyForCourier(missing.order.id);
    await db().stockMovement.deleteMany({ where: { reference: missing.order.id, type: "SALE" } });
    await expect(bookCourierShipment(missing.order.id, "fixture_courier", actor)).rejects.toThrow(/sale movements/);
    await expect(assignManualCourier({ orderId: missing.order.id, courierName: "Fixture" }, actor)).rejects.toThrow(/sale movements/);
    const unpaid = await sale(2, "sslcommerz");
    // Simulate an inconsistent legacy status, not a normal writer.
    await db().order.update({ where: { id: unpaid.order.id }, data: { status: "CONFIRMED" } });
    await expect(bookCourierShipment(unpaid.order.id, "fixture_courier", actor)).rejects.toThrow(/verified payment/);
    await expect(assignManualCourier({ orderId: unpaid.order.id, courierName: "Fixture" }, actor)).rejects.toThrow(/verified payment/);
    expect(mocks.createShipment).not.toHaveBeenCalled();
    expect(await stock(missing.variantId)).toBe(1);
    expect(await stock(unpaid.variantId)).toBe(1);
  });

  it("does not let claim age create a competing finalizer while the original provider call is delayed", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const entered = deferred();
    const release = deferred();
    mocks.createShipment.mockImplementation(async () => {
      entered.resolve(); await release.promise;
      return { consignmentId: "delayed-c", trackingId: "delayed-t", raw: {} };
    });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor);
    await entered.promise;
    try {
      await db().courierShipment.updateMany({ where: { orderId: order.id }, data: { createdAt: new Date("2000-01-01") } });
      await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record/i);
      await expect(cancelOrder(order.id, actor, "Old claim")).rejects.toThrow(/courier record/i);
      expect(mocks.createShipment).toHaveBeenCalledTimes(1);
      expect(await stock(variantId)).toBe(1);
    } finally { release.resolve(); }
    expect((await booking).status).toBe("BOOKED");
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  }, 20_000);

  it("serializes competing finalizers and treats identical provider responses as one booking", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const entered = deferred();
    const release = deferred();
    const result = { consignmentId: "same-c", trackingId: "same-t", cost: 50, raw: { accepted: true } };
    mocks.createShipment.mockImplementation(async () => { entered.resolve(); await release.promise; return result; });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor);
    await entered.promise;
    try {
      const claim = await capturedClaim(order.id);
      const [first, second] = await Promise.all([finalizeCourierBooking(claim, result), finalizeCourierBooking(claim, result)]);
      expect(first.safe).toBe(true);
      expect(second.safe).toBe(true);
      expect(first.shipment.id).toBe(second.shipment.id);
    } finally { release.resolve(); }
    const resultShipment = await booking;
    expect(resultShipment.status).toBe("BOOKED");
    expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db().courierTrackingEvent.count({ where: { shipmentId: resultShipment.id, status: "BOOKED" } })).toBe(1);
    expect(await db().auditLog.count({ where: { entityId: resultShipment.id, action: "COURIER_BOOKED" } })).toBe(1);
    expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    await expect(cancelOrder(order.id, actor, "Booked")).rejects.toThrow(/courier record/i);
    expect(await stock(variantId)).toBe(1);
  }, 20_000);

  it("preserves conflicting provider responses for reconciliation and rejects a delayed finalizer", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const entered = deferred();
    const release = deferred();
    const firstResult = { consignmentId: "first-c", trackingId: "first-t", raw: { provider: "first" } };
    const secondResult = { consignmentId: "second-c", trackingId: "second-t", raw: { provider: "second" } };
    mocks.createShipment.mockImplementation(async () => { entered.resolve(); await release.promise; return firstResult; });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    await entered.promise;
    try {
      const claim = await capturedClaim(order.id);
      expect((await finalizeCourierBooking(claim, firstResult)).safe).toBe(true);
      expect((await finalizeCourierBooking(claim, secondResult)).safe).toBe(false);
      const pending = await db().courierShipment.findUniqueOrThrow({ where: { id: claim.shipmentId } });
      expect(pending.status).toBe("PENDING");
      expect(pending.consignmentId).toBe("first-c");
      expect(pending.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" },
        providerResponse: { provider: "first" }, conflictingProviderResult: { consignmentId: "second-c", trackingId: "second-t" } });
      await expect(cancelOrder(order.id, actor, "Conflicting responses")).rejects.toThrow(/courier record/i);
    } finally { release.resolve(); }
    expect(await booking).toEqual(expect.objectContaining({ message: expect.stringMatching(/may have been created/) }));
    expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  }, 20_000);

  it.each(["settings", "credentials", "sandbox", "disabled"] as const)(
    "keeps a provider success pending if %s changes during the request", async (changed) => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const original = await db().courierProviderConfiguration.findUniqueOrThrow({ where: { code: "fixture_courier" } });
    const entered = deferred();
    const release = deferred();
    mocks.createShipment.mockImplementation(async () => {
      entered.resolve(); await release.promise;
      return { consignmentId: "config-c", trackingId: "config-t", raw: {} };
    });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor);
    await entered.promise;
    try {
      await db().courierProviderConfiguration.update({ where: { id: original.id }, data:
        changed === "settings" ? { settings: { changed: true } }
          : changed === "credentials" ? { credentials: { apiKey: "rotated-fixture-key" } }
            : changed === "sandbox" ? { sandbox: !original.sandbox } : { enabled: false },
      });
    } finally { release.resolve(); }
    try {
      await expect(booking).rejects.toThrow(/order changed/i);
      const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(claim.status).toBe("PENDING");
      expect(claim.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" } });
      expect(claim.consignmentId).toBe("config-c");
      await expect(cancelOrder(order.id, actor, "Configuration changed")).rejects.toThrow(/courier record/i);
      expect(await stock(variantId)).toBe(1);
    } finally {
      await db().courierProviderConfiguration.update({ where: { id: original.id }, data: {
        settings: original.settings as never, credentials: original.credentials as never,
        sandbox: original.sandbox, enabled: original.enabled,
      } });
    }
  }, 20_000);

  it.each(["changed", "changed then restored"] as const)(
    "binds the provider request to its endpoint snapshot when the environment is %s", async (change) => {
      const { order, variantId } = await sale();
      await readyForCourier(order.id);
      const entered = deferred(); const release = deferred();
      vi.stubEnv("FIXTURE_COURIER_API_BASE", "https://snapshot.fixture.invalid");
      mocks.createShipment.mockImplementation(async () => {
        entered.resolve(); await release.promise;
        return { consignmentId: "endpoint-c", trackingId: "endpoint-t", raw: {} };
      });
      const booking = bookCourierShipment(order.id, "fixture_courier", actor).then((shipment) => shipment, (error: unknown) => error);
      try {
        await entered.promise;
        expect(mocks.createShipment.mock.calls[0][0].apiBaseOverride).toBe("https://snapshot.fixture.invalid");
        vi.stubEnv("FIXTURE_COURIER_API_BASE", "https://different.fixture.invalid");
        if (change === "changed then restored") vi.stubEnv("FIXTURE_COURIER_API_BASE", "https://snapshot.fixture.invalid");
        release.resolve();
        const result = await booking;
        const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
        if (change === "changed") {
          expect(result).toEqual(expect.objectContaining({ message: expect.stringMatching(/order changed/i) }));
          expect(claim.status).toBe("PENDING");
          expect(claim.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" } });
        } else {
          expect(result).toEqual(expect.objectContaining({ status: "BOOKED" }));
          expect(claim.status).toBe("BOOKED");
        }
        await expect(cancelOrder(order.id, actor, "Endpoint snapshot")).rejects.toThrow(/courier record/i);
        expect(await stock(variantId)).toBe(1);
        expect(mocks.createShipment).toHaveBeenCalledTimes(1);
      } finally { release.resolve(); await booking; vi.unstubAllEnvs(); }
    }, 20_000);

  it("does not persist a secret-bearing endpoint override in the local courier claim", async () => {
    const { order } = await sale();
    await readyForCourier(order.id);
    const endpoint = "https://fixture-user:fixture-secret@snapshot.fixture.invalid";
    vi.stubEnv("FIXTURE_COURIER_API_BASE", endpoint);
    mocks.createShipment.mockResolvedValue({ consignmentId: "private-endpoint-c", trackingId: "private-endpoint-t", raw: {} });
    try {
      const shipment = await bookCourierShipment(order.id, "fixture_courier", actor);
      expect(mocks.createShipment.mock.calls[0][0].apiBaseOverride).toBe(endpoint);
      expect(JSON.stringify(shipment.payload)).not.toContain("fixture-secret");
      expect(JSON.stringify(shipment.payload)).not.toContain(endpoint);
      expect(JSON.stringify(await db().auditLog.findMany({ where: { entityId: shipment.id } }))).not.toContain("fixture-secret");
    } finally { vi.unstubAllEnvs(); }
  });

  it("holds the courier configuration stable through finalization commit", async () => {
    const { order } = await sale();
    await readyForCourier(order.id);
    const original = await db().courierProviderConfiguration.findUniqueOrThrow({ where: { code: "fixture_courier" } });
    const entered = deferred(); const providerRelease = deferred();
    mocks.createShipment.mockImplementation(async () => {
      entered.resolve(); await providerRelease.promise;
      return { consignmentId: "stable-config-c", trackingId: "stable-config-t", raw: {} };
    });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor).then((value) => value, (error: unknown) => error);
    await entered.promise;
    const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
    const locked = deferred(); const unlock = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CourierShipment" WHERE "id" = ${claim.id} FOR UPDATE`;
      locked.resolve(); await unlock.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    let mutation: Promise<unknown> | undefined;
    try {
      providerRelease.resolve();
      await waitForBlocked("CourierShipment");
      mutation = db().courierProviderConfiguration.update({ where: { id: original.id }, data: { credentials: { rotated: "fixture" } } })
        .then((value) => value, (error: unknown) => error);
      await waitForBlocked("CourierProviderConfiguration");
      unlock.resolve();
      await blocker;
      expect(await booking).toEqual(expect.objectContaining({ status: "BOOKED" }));
      expect(await mutation).not.toBeInstanceOf(Error);
      await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record.*reconciliation/i);
      expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    } finally {
      providerRelease.resolve(); unlock.resolve(); await blocker; await booking; await mutation;
      await db().courierProviderConfiguration.update({ where: { id: original.id }, data: { credentials: original.credentials as never } });
    }
  }, 20_000);

  it("retains an unknown provider timeout and forbids retry, tracking sync, fulfillment and stock release", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    mocks.createShipment.mockRejectedValueOnce(new Error("synthetic provider timeout"));
    await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/may have been created/);
    const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(claim.status).toBe("PENDING");
    expect(claim.payload).toMatchObject({ landiqBooking: { state: "OUTCOME_UNKNOWN", merchantReference: order.orderNumber } });
    expect(await db().auditLog.count({ where: { entityId: claim.id, action: "COURIER_RECONCILIATION_REQUIRED" } })).toBe(1);
    await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record/i);
    await expect(syncCourierTracking(claim.id, actor)).rejects.toThrow(/unresolved/);
    await expect(updateOrderStatus(order.id, "SHIPPED", actor)).rejects.toThrow(/unresolved/);
    await expect(cancelOrder(order.id, actor, "Unknown provider outcome")).rejects.toThrow(/courier record/i);
    expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  });

  it.each([
    ["missing tracking reference", { consignmentId: "c", trackingId: "", raw: { response: "missing" } }],
    ["negative fee", { consignmentId: "c", trackingId: "t", cost: -1, raw: { response: "bad-fee" } }],
    ["unsafe tracking URL", { consignmentId: "c", trackingId: "t", trackingUrl: "javascript:alert(1)", raw: {} }],
    ["non-JSON provider response", { consignmentId: "c", trackingId: "t", raw: { value: Infinity } }],
  ])("treats a %s as an unknown courier outcome", async (_label, response) => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    mocks.createShipment.mockResolvedValueOnce(response);
    await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/may have been created/);
    const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(claim.status).toBe("PENDING");
    expect(claim.payload).toMatchObject({ landiqBooking: { state: "OUTCOME_UNKNOWN" } });
    await expect(cancelOrder(order.id, actor, "Bad provider response")).rejects.toThrow(/courier record/i);
    expect(await stock(variantId)).toBe(1);
  });

  it("keeps known provider references pending if order details change during the request", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const entered = deferred();
    const release = deferred();
    mocks.createShipment.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return { consignmentId: "known-consignment", trackingId: "known-tracking", raw: { accepted: true } };
    });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor);
    await entered.promise;
    try {
      // Model a legacy/non-cooperating writer changing the provider request snapshot.
      await db().order.update({ where: { id: order.id }, data: { address: "Changed during provider call" } });
    } finally { release.resolve(); }
    await expect(booking).rejects.toThrow(/order changed/i);
    const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(claim.status).toBe("PENDING");
    expect(claim.consignmentId).toBe("known-consignment");
    expect(claim.trackingId).toBe("known-tracking");
    expect(claim.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" }, providerResponse: { accepted: true } });
    await expect(cancelOrder(order.id, actor, "Changed order")).rejects.toThrow(/courier record/i);
    expect(await stock(variantId)).toBe(1);
  });

  it.each(["customer", "product", "order item"] as const)("holds the %s snapshot stable until courier booking commits", async (target) => {
    const { order } = await sale();
    await readyForCourier(order.id);
    const entered = deferred();
    const providerRelease = deferred();
    mocks.createShipment.mockImplementation(async () => {
      entered.resolve();
      await providerRelease.promise;
      return { consignmentId: "stable-consignment", trackingId: "stable-tracking", raw: {} };
    });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor).then((value) => value, (error: unknown) => error);
    await entered.promise;
    const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
    const shipmentLocked = deferred();
    const shipmentRelease = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CourierShipment" WHERE "id" = ${claim.id} FOR UPDATE`;
      shipmentLocked.resolve();
      await shipmentRelease.promise;
    }, { timeout: 15_000 });
    await shipmentLocked.promise;
    providerRelease.resolve();
    let mutation: Promise<unknown> | undefined;
    let mutationFinished = false;
    let mutationBlocked = false;
    try {
      // Finalization has read the request and is waiting to write the claim.
      await waitForBlocked("CourierShipment");
      mutation = (target === "customer"
        ? db().customer.update({ where: { id: order.customerId }, data: { name: "Updated Buyer" } })
        : target === "product"
          ? db().product.update({ where: { id: order.productId }, data: { weightGrams: 1500 } })
          : db().orderItem.updateMany({ where: { orderId: order.id }, data: { attributes: [{ name: "Size", value: "XL" }] } }))
        .then((value) => { mutationFinished = true; return value; }, (error: unknown) => { mutationFinished = true; return error; });
      const deadline = Date.now() + 6_000;
      while (!mutationFinished && Date.now() < deadline) {
        const fragment = target === "customer" ? "Customer" : target === "product" ? "Product" : "OrderItem";
        const rows = await db().$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS "count" FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}
        `;
        if (Number(rows[0]?.count ?? 0) > 0) { mutationBlocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      shipmentRelease.resolve();
      await blocker;
    }
    expect(await booking).toEqual(expect.objectContaining({ status: "BOOKED" }));
    await mutation;
    expect(mutationBlocked).toBe(true);
    await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record.*reconciliation/i);
    expect(mocks.createShipment).toHaveBeenCalledTimes(1);
  }, 20_000);

  it.each(["PENDING", "FAILED", "CANCELLED"] as const)("blocks return creation and restocking for ambiguous legacy %s courier records", async (status) => {
    const { order, variantId } = await sale();
    await ship(order.id);
    const request = await createReturnRequest({ orderId: order.id, reason: "Damaged item" }, actor);
    await updateReturnStatus(request.id, "APPROVED", actor);
    await updateReturnStatus(request.id, "INSPECTED", actor);
    await db().courierShipment.create({ data: { orderId: order.id, providerCode: "legacy", status, createdById: actor } });
    await expect(createReturnRequest({ orderId: order.id, reason: "Another reason" }, actor)).rejects.toThrow(/unresolved/);
    await expect(updateReturnStatus(request.id, "RESTOCKED", actor)).rejects.toThrow(/unresolved/);
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "RETURN")).toHaveLength(0);
  });

  it("records a paid callback for reconciliation instead of confirming a legacy pending courier claim", async () => {
    const online = await sale(2, "sslcommerz");
    await db().courierShipment.create({ data: { orderId: online.order.id, providerCode: "legacy", status: "PENDING", createdById: actor } });
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: online.order.id } });
    mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
    await expect(processPaymentCallback("sslcommerz", { tran_id: payment.reference })).resolves.toMatchObject({ ok: false, requiresReconciliation: true });
    expect((await db().order.findUniqueOrThrow({ where: { id: online.order.id } })).status).toBe("PENDING");
    expect((await db().paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID_REQUIRES_RECONCILIATION");
    expect(await stock(online.variantId)).toBe(1);
  });

  it("retains reported provider references when local booking persistence fails", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    mocks.createShipment.mockResolvedValue({ consignmentId: "reported-consignment", trackingId: "reported-tracking", raw: { accepted: true } });
    // Fixture-only fault injection on this newly created, verified database.
    await db().$executeRawUnsafe(`CREATE FUNCTION "fixture_reject_booked"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."status" = 'BOOKED' THEN RAISE EXCEPTION 'fixture booking write failure'; END IF; RETURN NEW; END $$`);
    await db().$executeRawUnsafe(`CREATE TRIGGER "fixture_reject_booked" BEFORE UPDATE ON "CourierShipment"
      FOR EACH ROW EXECUTE FUNCTION "fixture_reject_booked"()`);
    try {
      await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/may have been created/);
    } finally {
      await db().$executeRawUnsafe(`DROP TRIGGER "fixture_reject_booked" ON "CourierShipment"`);
      await db().$executeRawUnsafe(`DROP FUNCTION "fixture_reject_booked"()`);
    }
    const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(claim.status).toBe("PENDING");
    expect(claim.consignmentId).toBe("reported-consignment");
    expect(claim.trackingId).toBe("reported-tracking");
    expect(claim.payload).toMatchObject({ landiqBooking: { state: "RECONCILIATION_REQUIRED" }, providerResponse: { accepted: true } });
    await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record/i);
    await expect(cancelOrder(order.id, actor, "Local write failure")).rejects.toThrow(/courier record/i);
    expect(mocks.createShipment).toHaveBeenCalledTimes(1);
    expect(await stock(variantId)).toBe(1);
  });

  it("retains a durable claim after the booking process is killed during a mocked provider request", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    if (!workerConnection) throw new Error("Disposable worker connection was not verified");
    const worker = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/fixtures/courier-crash-worker.ts"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, NODE_ENV: "test", DATABASE_URL: "postgresql://invalid:invalid@invalid:1/invalid" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stderr = "";
    worker.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const entered = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Crash worker did not enter the mocked provider: ${stderr}`)), 15_000);
      worker.on("message", (message: unknown) => {
        if (typeof message !== "object" || message === null || !("event" in message)) return;
        if (message.event === "mock-provider-entered") { clearTimeout(timer); resolve(); }
        if (message.event === "worker-error") {
          clearTimeout(timer);
          reject(new Error(`Crash worker failed: ${"message" in message ? String(message.message) : "unknown"}; ${stderr}`));
        }
      });
      worker.once("error", (error) => { clearTimeout(timer); reject(error); });
      worker.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (signal !== "SIGKILL") reject(new Error(`Crash worker exited early (${code ?? signal}): ${stderr}`));
      });
    });
    try {
      worker.send({ ...workerConnection, orderId: order.id, actorId: actor });
      await entered;
      const exit = new Promise<{ signal: NodeJS.Signals | null }>((resolve) => worker.once("exit", (_code, signal) => resolve({ signal })));
      if (!worker.kill("SIGKILL")) throw new Error("Could not kill the crash worker");
      expect((await exit).signal).toBe("SIGKILL");
      const claim = await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(claim.status).toBe("PENDING");
      expect(claim.providerCode).toBe("steadfast");
      expect(claim.payload).toMatchObject({ landiqBooking: { state: "AWAITING_RESULT", sandbox: true } });
      expect(await db().auditLog.count({ where: { entityId: claim.id, action: "COURIER_BOOKING_CLAIMED" } })).toBe(1);
      await expect(bookCourierShipment(order.id, "fixture_courier", actor)).rejects.toThrow(/courier record/i);
      await expect(assignManualCourier({ orderId: order.id, courierName: "Replacement" }, actor)).rejects.toThrow(/courier record/i);
      await expect(updateOrderStatus(order.id, "SHIPPED", actor)).rejects.toThrow(/unresolved/);
      await expect(cancelOrder(order.id, actor, "Process was killed")).rejects.toThrow(/courier record/i);
      expect(mocks.createShipment).not.toHaveBeenCalled();
      expect(await stock(variantId)).toBe(1);
      expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        const exit = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
        worker.kill("SIGKILL");
        await exit;
      }
    }
  }, 30_000);

  // This deliberately remains a safety assertion, not an expected-failure or
  // characterization pass. Execute the byte-identical f151222 old writer:
  // its provider call has started but no durable local claim exists yet.
  it("prevents restoration while an actual pre-upgrade unclaimed courier request is in flight", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const entered = deferred();
    const release = deferred();
    mocks.createShipment.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return { consignmentId: "legacy-consignment", trackingId: "legacy-tracking", raw: {} };
    });
    const legacyBooking = legacyBookCourierShipment(order.id, "fixture_courier", actor);
    await entered.promise;
    let cancellation: unknown;
    try {
      expect(await db().courierShipment.count({ where: { orderId: order.id } })).toBe(0);
      cancellation = await cancelOrder(order.id, actor, "Mixed-version cutover race").then(() => null, (error: unknown) => error);
    } finally { release.resolve(); }
    const legacyShipment = await legacyBooking;
    const observed = {
      cancellationBlocked: cancellation instanceof Error,
      orderStatus: (await db().order.findUniqueOrThrow({ where: { id: order.id } })).status,
      stock: await stock(variantId),
      cancellationMovements: (await movements(order.id, "CANCELLATION")).length,
      shipmentStatus: legacyShipment.status,
    };
    expect(observed).toEqual({ cancellationBlocked: true, orderStatus: "READY_TO_SHIP", stock: 1,
      cancellationMovements: 0, shipmentStatus: "BOOKED" });
  }, 20_000);

  it("prevents an actual pre-upgrade booking from starting after a new cancellation", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    await cancelOrder(order.id, actor, "Mixed-version cancellation first");
    mocks.createShipment.mockResolvedValue({ consignmentId: "late-legacy-c", trackingId: "late-legacy-t", raw: {} });
    const outcome = await legacyBookCourierShipment(order.id, "fixture_courier", actor).then(() => null, (error: unknown) => error);
    const observed = {
      bookingBlocked: outcome instanceof Error,
      orderStatus: (await db().order.findUniqueOrThrow({ where: { id: order.id } })).status,
      stock: await stock(variantId),
      shipmentCount: await db().courierShipment.count({ where: { orderId: order.id } }),
      providerCalls: mocks.createShipment.mock.calls.length,
    };
    expect(observed).toEqual({ bookingBlocked: true, orderStatus: "CANCELLED", stock: 2, shipmentCount: 0, providerCalls: 0 });
  });

  // The opposite mixed-version direction matters too: a durable new claim
  // cannot constrain an old cancellation writer that never reads shipments.
  it("prevents an actual pre-upgrade cancellation from restoring stock during a new booking", async () => {
    const { order, variantId } = await sale();
    await readyForCourier(order.id);
    const entered = deferred();
    const release = deferred();
    mocks.createShipment.mockImplementation(async () => {
      entered.resolve(); await release.promise;
      return { consignmentId: "new-consignment", trackingId: "new-tracking", raw: {} };
    });
    const booking = bookCourierShipment(order.id, "fixture_courier", actor).then((value) => value, (error: unknown) => error);
    await entered.promise;
    let cancellation: unknown;
    try {
      expect(await db().courierShipment.count({ where: { orderId: order.id, status: "PENDING" } })).toBe(1);
      cancellation = await legacyCancelOrder(order.id, actor, "Mixed-version cutover race").then(() => null, (error: unknown) => error);
    } finally { release.resolve(); }
    await booking;
    const observed = {
      cancellationBlocked: cancellation instanceof Error,
      orderStatus: (await db().order.findUniqueOrThrow({ where: { id: order.id } })).status,
      stock: await stock(variantId),
      cancellationMovements: (await movements(order.id, "CANCELLATION")).length,
      shipmentStatus: (await db().courierShipment.findFirstOrThrow({ where: { orderId: order.id } })).status,
    };
    expect(observed).toEqual({ cancellationBlocked: true, orderStatus: "READY_TO_SHIP", stock: 1,
      cancellationMovements: 0, shipmentStatus: "BOOKED" });
  }, 20_000);

  it("records an internal refund atomically and makes exact retries idempotent", async () => {
    const { order, variantId } = await sale();
    await collectCod(order.id, order.total, actor);
    const input = { orderId: order.id, amount: 300, reason: "First internal refund", idempotencyKey: randomUUID() };
    const [first, retry] = await Promise.all([recordRefund(input, actor), recordRefund(input, actor)]);
    expect(first.id).toBe(retry.id);
    expect(await db().refund.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db().auditLog.count({ where: { entityId: first.id, action: "RECORD_REFUND" } })).toBe(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).financialStatus).toBe("PARTIALLY_SETTLED");
    await expect(recordRefund({ ...input, amount: 301 }, actor)).rejects.toThrow(/key.*different details/);
    await expect(recordRefund({ ...input, amount: 201, reason: "Excess", idempotencyKey: randomUUID() }, actor)).rejects.toThrow(/exceeds/);
    await recordRefund({ ...input, amount: 200, reason: "Remaining balance", idempotencyKey: randomUUID() }, actor);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).financialStatus).toBe("REFUNDED");
    expect(await stock(variantId)).toBe(1);
    await expect(cancelOrder(order.id, actor, "Refunded")).rejects.toThrow();
  });

  it("serializes two different partial refunds against the paid balance", async () => {
    const { order, variantId } = await sale();
    await collectCod(order.id, order.total, actor);
    const one = { orderId: order.id, amount: 300, reason: "Partial one", idempotencyKey: randomUUID() };
    const two = { ...one, reason: "Partial two", idempotencyKey: randomUUID() };
    const results = await Promise.allSettled([recordRefund(one, actor), recordRefund(two, actor)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await db().refund.findMany({ where: { orderId: order.id } })).map((refund) => refund.amount)).toEqual([300]);
    expect(await stock(variantId)).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  });

  it.each(["unpaid", "collected"] as const)("serializes cancellation against a %s COD refund", async (paymentState) => {
    const { order, variantId } = await sale();
    if (paymentState === "collected") await collectCod(order.id, order.total, actor);
    const locked = deferred();
    const release = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      locked.resolve(); await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const cancellation = cancelOrder(order.id, actor, "Refund race").then(() => null, (error: unknown) => error);
    const refund = recordRefund({ orderId: order.id, amount: 300, reason: "Refund race", idempotencyKey: randomUUID() }, actor)
      .then(() => null, (error: unknown) => error);
    try { await waitForBlocked('FROM "Order"', 2); } finally { release.resolve(); }
    await blocker;
    const [cancelError, refundError] = await Promise.all([cancellation, refund]);
    const current = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    if (paymentState === "unpaid") {
      expect(cancelError).toBeNull(); expect(refundError).toBeInstanceOf(Error);
      expect(current.status).toBe("CANCELLED"); expect(await stock(variantId)).toBe(2);
      expect(await db().refund.count({ where: { orderId: order.id } })).toBe(0);
      expect(await movements(order.id, "CANCELLATION")).toHaveLength(1);
    } else {
      expect(cancelError).toBeInstanceOf(Error); expect(refundError).toBeNull();
      expect(current.status).toBe("PENDING"); expect(await stock(variantId)).toBe(1);
      expect(await db().refund.count({ where: { orderId: order.id } })).toBe(1);
      expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
    }
  }, 20_000);

  it("reserves an in-flight provider refund, rejects other refunds and never repeats the provider call", async () => {
    const { order, payment, variantId } = await paidOnline();
    await updateOrderStatus(order.id, "READY_TO_SHIP", actor);
    const entered = deferred();
    const release = deferred();
    mocks.refund.mockImplementation(async () => {
      entered.resolve(); await release.promise;
      return { status: "REFUNDED", providerReference: "provider-reported-refund", raw: { accepted: true } };
    });
    const input = { orderId: order.id, transactionId: payment.id, amount: 300, reason: "Provider refund", idempotencyKey: randomUUID() };
    const attempt = executeProviderRefund(input, actor);
    await entered.promise;
    try {
      const retry = await executeProviderRefund(input, actor);
      expect(retry.status).toBe("AWAITING_PROVIDER");
      await expect(executeProviderRefund({ ...input, amount: 301 }, actor)).rejects.toThrow(/key.*different details/);
      await expect(executeProviderRefund({ ...input, idempotencyKey: randomUUID() }, actor)).rejects.toThrow(/unresolved/);
      await expect(recordRefund({ orderId: order.id, amount: 100, reason: "Other", idempotencyKey: randomUUID() }, actor)).rejects.toThrow(/unresolved/);
      await expect(updateOrderStatus(order.id, "SHIPPED", actor)).rejects.toThrow(/refund.*reconciliation/i);
      await expect(cancelOrder(order.id, actor, "Refund pending")).rejects.toThrow();
      expect(await stock(variantId)).toBe(1);
      expect(mocks.refund).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); }
    const refund = await attempt;
    expect(refund.status).toBe("RECONCILIATION_REQUIRED");
    expect(refund.providerReference).toBe("provider-reported-refund");
    expect((await executeProviderRefund(input, actor)).id).toBe(refund.id);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).financialStatus).toBe("PARTIALLY_SETTLED");
    expect(await db().refund.count({ where: { orderId: order.id } })).toBe(1);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(0);
  }, 20_000);

  it("retains an unknown provider refund after timeout and never auto-retries it", async () => {
    const { order, payment, variantId } = await paidOnline();
    const input = { orderId: order.id, transactionId: payment.id, amount: 200, reason: "Timed out", idempotencyKey: randomUUID() };
    mocks.refund.mockRejectedValue(new Error("synthetic timeout"));
    await expect(executeProviderRefund(input, actor)).rejects.toThrow(/may have been sent/);
    expect((await executeProviderRefund(input, actor)).status).toBe("OUTCOME_UNKNOWN");
    await expect(executeProviderRefund({ ...input, idempotencyKey: randomUUID() }, actor)).rejects.toThrow(/unresolved/);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(await stock(variantId)).toBe(1);
    expect(await db().refund.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("retains a provider-refund claim when both response persistence and its fallback fail", async () => {
    const { order, payment, variantId } = await paidOnline();
    const input = { orderId: order.id, transactionId: payment.id, amount: 200, reason: "Persistence failure", idempotencyKey: randomUUID() };
    mocks.refund.mockResolvedValue({ status: "REFUNDED", providerReference: "reported-refund", raw: {} });
    await db().$executeRawUnsafe(`CREATE FUNCTION "fixture_reject_refund_finalization"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."status" = 'RECONCILIATION_REQUIRED' THEN RAISE EXCEPTION 'fixture refund write failure'; END IF; RETURN NEW; END $$`);
    await db().$executeRawUnsafe(`CREATE TRIGGER "fixture_reject_refund_finalization" BEFORE UPDATE ON "Refund"
      FOR EACH ROW EXECUTE FUNCTION "fixture_reject_refund_finalization"()`);
    try {
      await expect(executeProviderRefund(input, actor)).rejects.toThrow(/may have been sent/);
    } finally {
      await db().$executeRawUnsafe(`DROP TRIGGER "fixture_reject_refund_finalization" ON "Refund"`);
      await db().$executeRawUnsafe(`DROP FUNCTION "fixture_reject_refund_finalization"()`);
    }
    expect((await executeProviderRefund(input, actor)).status).toBe("AWAITING_PROVIDER");
    await expect(recordRefund({ orderId: order.id, amount: 100, reason: "Other", idempotencyKey: randomUUID() }, actor)).rejects.toThrow(/unresolved/);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(await stock(variantId)).toBe(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).financialStatus).toBe("PARTIALLY_SETTLED");
  });

  it("does not restock an inspected return while its provider refund is unresolved", async () => {
    const { order, payment, variantId } = await paidOnline();
    await updateOrderStatus(order.id, "PROCESSING", actor);
    await updateOrderStatus(order.id, "SHIPPED", actor);
    const request = await createReturnRequest({ orderId: order.id, reason: "Damaged item" }, actor);
    await updateReturnStatus(request.id, "APPROVED", actor);
    await updateReturnStatus(request.id, "INSPECTED", actor);
    const entered = deferred(); const release = deferred();
    mocks.refund.mockImplementation(async () => { entered.resolve(); await release.promise; return { status: "PENDING" }; });
    const refund = executeProviderRefund({ orderId: order.id, transactionId: payment.id, amount: 200,
      reason: "Refund return", idempotencyKey: randomUUID() }, actor);
    await entered.promise;
    try {
      await expect(updateReturnStatus(request.id, "RESTOCKED", actor)).rejects.toThrow(/refund outcome is unresolved/i);
      expect(await stock(variantId)).toBe(1);
    } finally { release.resolve(); }
    expect((await refund).status).toBe("RECONCILIATION_REQUIRED");
    await expect(updateReturnStatus(request.id, "RESTOCKED", actor)).rejects.toThrow(/refund outcome is unresolved/i);
    expect(await movements(order.id, "RETURN")).toHaveLength(0);
  }, 20_000);

  it("records a refund for a late verified capture without reopening or re-restoring a cancelled order", async () => {
    const { order, variantId } = await sale(2, "sslcommerz");
    const payment = await db().paymentTransaction.findFirstOrThrow({ where: { orderId: order.id } });
    await processPaymentCallback("sslcommerz", { tran_id: payment.reference });
    await db().stockReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(0) } });
    expect((await expireEligibleReservations(actor)).expired).toBe(1);
    mocks.verify.mockResolvedValue({ status: "PAID", reference: payment.reference, amount: payment.amount, currency: payment.currency, raw: {} });
    expect(await processPaymentCallback("sslcommerz", { tran_id: payment.reference })).toMatchObject({ requiresReconciliation: true });
    await recordRefund({ orderId: order.id, amount: order.total, reason: "Refund late capture", idempotencyKey: randomUUID() }, actor);
    const current = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(current.status).toBe("CANCELLED"); expect(current.financialStatus).toBe("REFUNDED");
    expect(await stock(variantId)).toBe(2);
    expect(await movements(order.id, "CANCELLATION")).toHaveLength(1);
  });

  it("serializes COD collection against cancellation, so stock restoration and collection cannot both win", async () => {
    const { order, variantId } = await sale();
    const locked = deferred();
    const release = deferred();
    const blocker = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const cancellation = cancelOrder(order.id, actor, "Race").then(() => null, (error: unknown) => error);
    const collection = collectCod(order.id, order.total, actor).then(() => null, (error: unknown) => error);
    try { await waitForBlocked('FROM "Order"', 2); } finally { release.resolve(); }
    await blocker;
    const results = await Promise.all([cancellation, collection]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    const current = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    if (current.status === "CANCELLED") {
      expect(current.paymentStatus).toBe("COD_PENDING");
      expect(await stock(variantId)).toBe(2);
    } else {
      expect(current.paymentStatus).toBe("COD_COLLECTED");
      expect(await stock(variantId)).toBe(1);
    }
  }, 20_000);
});
