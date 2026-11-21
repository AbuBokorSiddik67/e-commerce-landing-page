import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { seed } from "../../prisma/seed-core";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Exercise authentication and staff actions only through the already verified
// fixture client, never the ambient DATABASE_URL or a real browser/session.
const authFixture = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  token: null as string | null,
  afterUserRead: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, {
  get(_target, key) {
    if (!authFixture.client) throw new Error("Disposable database identity has not been verified");
    const value: unknown = Reflect.get(authFixture.client, key, authFixture.client);
    if (key === "user" && value && typeof value === "object") {
      return new Proxy(value, {
        get(delegate, operation) {
          const method: unknown = Reflect.get(delegate, operation, delegate);
          if (operation === "findUnique" && typeof method === "function") return async (...args: unknown[]) => {
            const result: unknown = await Reflect.apply(method, delegate, args);
            const hook = authFixture.afterUserRead;
            authFixture.afterUserRead = null;
            if (hook) await hook();
            return result;
          };
          return typeof method === "function" ? method.bind(delegate) : method;
        },
      });
    }
    return typeof value === "function" ? value.bind(authFixture.client) : value;
  },
}) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => authFixture.token ? { value: authFixture.token } : undefined,
    set: (_name: string, value: string) => { authFixture.token = value; },
    delete: () => { authFixture.token = null; },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "disposable-auth-fixture" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`TEST_REDIRECT:${url}`); } }));

import { changePasswordAction } from "@/app/actions/auth";
import { createStaffAction, resetStaffPasswordAction, updateStaffRolesAction } from "@/app/actions/staff";
import { GET as exportOrders } from "@/app/api/orders/export/route";
import { GET as listMedia } from "@/app/api/media/route";
import { consumePasswordResetToken, createPasswordResetToken, getCurrentUser, login, requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";

// Explicit opt-in. The suite NEVER reads DATABASE_URL. It makes a new cluster
// and five empty, randomly named databases, verifies the spawned process and
// database identity, then executes the checked-in SQL ONLY on that cluster.
// It does not exercise the Prisma migration CLI or a real installation.
const enabled = process.env.LANDIQ_MIGRATION_DISPOSABLE_PG === "1";
const root = path.resolve(process.cwd(), "tmp");
let scratch: string | undefined;
let postgres: EmbeddedPostgres | undefined;
let started = false;
const clients: Client[] = [];
let migrated: Client;
let reference: Client;
let broken: Client;
let fresh: Client;
let demo: Client;
let phase1Sql: string;
const prismaClients: PrismaClient[] = [];
let freshPrisma: PrismaClient;
let demoPrisma: PrismaClient;
let existingPrisma: PrismaClient;

// Pause only the next non-transactional auth user read, after PostgreSQL has
// returned its snapshot. This makes the races deterministic without sleeps.
function pauseNextAuthUserRead() {
  let observed!: () => void;
  let resume!: () => void;
  const read = new Promise<void>((resolve) => { observed = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  authFixture.afterUserRead = async () => { observed(); await release; };
  return { read, resume };
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No free port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function catalog(client: Client) {
  const tables = await client.query(`
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname
  `);
  const columns = await client.query(`
    SELECT c.relname AS table_name, a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
      pg_get_expr(d.adbin, d.adrelid) AS default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname, a.attname
  `);
  const enums = await client.query(`
    SELECT t.typname AS name, e.enumlabel AS value FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public' ORDER BY t.typname, e.enumsortorder
  `);
  const constraints = await client.query(`
    SELECT c.relname AS table_name, co.conname AS name, co.contype AS type,
      pg_get_constraintdef(co.oid, true) AS definition
    FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    ORDER BY c.relname, co.conname
  `);
  const indexes = await client.query(`
    SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);
  return { tables: tables.rows, columns: columns.rows, enums: enums.rows, constraints: constraints.rows, indexes: indexes.rows };
}

describe.skipIf(!enabled)("Phase 1 migration SQL on an identity-verified disposable PostgreSQL cluster", () => {
  beforeAll(async () => {
    await mkdir(root, { recursive: true });
    scratch = await mkdtemp(path.join(root, "phase1-migration-"));
    const directory = path.join(scratch, "data");
    const host = "127.0.0.1";
    const port = await freePort();
    const user = `migration_${randomBytes(10).toString("hex")}`;
    const password = randomBytes(32).toString("hex");
    const names = Array.from({ length: 5 }, () => `migration_${randomBytes(10).toString("hex")}`);
    if (!/^migration_[a-f0-9]{20}$/.test(user) || names.some((name) => !/^migration_[a-f0-9]{20}$/.test(name))) {
      throw new Error("Invalid generated database identity");
    }
    postgres = new EmbeddedPostgres({ databaseDir: directory, port, user, password, persistent: false,
      autoRehydrateSymlinks: true, postgresFlags: ["-c", `listen_addresses=${host}`, "-c", `unix_socket_directories=${scratch}`],
      onLog: () => {}, onError: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    started = true;
    const postmaster = (await readFile(path.join(directory, "postmaster.pid"), "utf8")).split("\n");
    const spawned = (postgres as unknown as { process?: { pid?: number } }).process?.pid;
    if (!spawned || Number(postmaster[0]) !== spawned || await realpath(postmaster[1]) !== await realpath(directory)
      || Number(postmaster[3]) !== port || postmaster[4] !== scratch || postmaster[5] !== host) {
      throw new Error("Refusing to connect: local PostgreSQL process identity mismatch");
    }

    async function connect(database: string) {
      const client = new Client({ host, port, user, password, database, ssl: false });
      clients.push(client);
      await client.connect();
      const { rows } = await client.query(`
        SELECT current_setting('data_directory') AS directory, current_database()::text AS database,
          current_user::text AS username, inet_server_port() AS port, host(inet_server_addr()) AS host,
          current_schema()::text AS schema
      `);
      const actual = rows[0];
      if (!actual || await realpath(actual.directory) !== await realpath(directory) || actual.database !== database
        || actual.username !== user || actual.port !== port || actual.host !== host || actual.schema !== "public") {
        throw new Error("Refusing test writes: database identity mismatch");
      }
      return client;
    }
    const admin = await connect("postgres");
    for (const name of names) await admin.query(`CREATE DATABASE "${name}"`);
    [migrated, reference, broken, fresh, demo] = await Promise.all(names.map(connect));
    for (const client of [migrated, reference, broken, fresh, demo]) {
      const { rows } = await client.query(`
        SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')) AS tables,
          (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype IN ('e', 'c', 'd')) AS types
      `);
      if (Number(rows[0].tables) || Number(rows[0].types)) throw new Error("Refusing to initialize a nonempty database");
    }
    console.info("Verified disposable migration databases", { host, port, databases: names, user, directory, pid: spawned });
    const initial = await readFile("prisma/migrations/20261119171130_init/migration.sql", "utf8");
    const normalize = await readFile("prisma/migrations/20261120050000_normalize_variant_attributes/migration.sql", "utf8");
    phase1Sql = await readFile("prisma/migrations/20261120060000_phase1_order_inventory/migration.sql", "utf8");
    const fixture = await readFile("tests/fixtures/phase1-disposable-schema.sql", "utf8");
    const fixtureStatements = fixture.replace(/^--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean);
    if (!fixtureStatements.length || fixtureStatements.some((sql) => !/^CREATE\s+(?:TYPE|TABLE|(?:UNIQUE\s+)?INDEX)\s/i.test(sql))) {
      throw new Error("Refusing non-CREATE-only reference fixture");
    }

    await migrated.query(initial);
    // Synthetic legacy rows intentionally include an existing return and stock
    // movement; no data from an installation is read or inferred.
    await migrated.query(`
      INSERT INTO "User" ("id", "name", "email", "passwordHash", "updatedAt")
        VALUES ('actor', 'Fixture staff', 'migration@fixture.invalid', 'not-a-login', CURRENT_TIMESTAMP);
      INSERT INTO "Product" ("id", "name", "slug", "regularPrice", "updatedAt")
        VALUES ('product', 'Fixture product', 'migration-fixture', 500, CURRENT_TIMESTAMP);
      INSERT INTO "ProductVariant" ("id", "productId", "name", "stock", "attributes", "updatedAt")
        VALUES ('variant', 'product', 'M', 7, '{"Size":"M","Color":"Black"}'::jsonb, CURRENT_TIMESTAMP);
      INSERT INTO "Customer" ("id", "name", "phone", "updatedAt")
        VALUES ('customer', 'Fixture buyer', '01700000000', CURRENT_TIMESTAMP);
      INSERT INTO "Order" ("id", "orderNumber", "customerId", "productId", "variantId", "quantity", "subtotal", "total",
        "status", "address", "district", "trackingToken", "updatedAt")
        VALUES ('order', 'MIGRATION-1', 'customer', 'product', 'variant', 2, 1000, 1000,
          'CANCELLED', 'Fixture address', 'Rajshahi', 'fixture-token', CURRENT_TIMESTAMP);
      INSERT INTO "OrderItem" ("id", "orderId", "variantId", "name", "unitPrice", "quantity", "lineTotal", "attributes")
        VALUES ('item', 'order', 'variant', 'Snapshot', 500, 2, 1000, '{"Size":"M"}'::jsonb);
      INSERT INTO "ReturnRequest" ("id", "orderId", "productId", "reason", "status", "updatedAt")
        VALUES ('return', 'order', 'product', 'Legacy return', 'RESTOCKED', CURRENT_TIMESTAMP);
      INSERT INTO "StockMovement" ("id", "productId", "variantId", "type", "quantity", "balanceAfter", "reference")
        VALUES ('movement', 'product', 'variant', 'RETURN', 2, 7, 'legacy-reference');
      INSERT INTO "CourierShipment" ("id", "orderId", "providerCode", "status", "updatedAt")
        VALUES ('shipment', 'order', 'fixture', 'CANCELLED', CURRENT_TIMESTAMP);
    `);
    await migrated.query(normalize);
    await migrated.query(phase1Sql);
    await reference.query(fixture);
    await broken.query(initial);
    await broken.query(normalize);
    await broken.query('CREATE TABLE "OwnDelivery" ("id" TEXT PRIMARY KEY)');
    for (const client of [fresh, demo]) {
      await client.query(initial);
      await client.query(normalize);
      await client.query(phase1Sql);
    }
    // A real migrated installation has this ledger; seeding must ignore it.
    await fresh.query('CREATE TABLE "_prisma_migrations" (id TEXT PRIMARY KEY)');
    await fresh.query('INSERT INTO "_prisma_migrations" (id) VALUES ($1)', ["fixture-ledger"]);
    const makePrisma = (database: string) => {
      const client = new PrismaClient({ adapter: new PrismaPg({ host, port, user, password, database, ssl: false }) });
      prismaClients.push(client);
      return client;
    };
    [existingPrisma, freshPrisma, demoPrisma] = [names[0], names[3], names[4]].map(makePrisma);
    authFixture.client = freshPrisma;
  }, 90_000);

  afterAll(async () => {
    authFixture.client = null; authFixture.token = null; authFixture.afterUserRead = null;
    for (const client of prismaClients) await client.$disconnect().catch(() => undefined);
    for (const client of clients) await client.end().catch(() => undefined);
    if (postgres && started) await postgres.stop();
    if (scratch && path.dirname(scratch) === root && path.basename(scratch).startsWith("phase1-migration-")) {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves legacy records and does not invent receipt or cancellation evidence", async () => {
    const variant = (await migrated.query('SELECT "stock", "damagedStock", "attributes" FROM "ProductVariant" WHERE id = $1', ["variant"])).rows[0];
    expect(variant).toEqual({ stock: 7, damagedStock: 0, attributes: [{ name: "Color", value: "Black" }, { name: "Size", value: "M" }] });
    const order = (await migrated.query('SELECT "status", "cancellationReason", "cancellationStockReleasedAt" FROM "Order" WHERE id = $1', ["order"])).rows[0];
    expect(order).toEqual({ status: "CANCELLED", cancellationReason: null, cancellationStockReleasedAt: null });
    const movement = (await migrated.query('SELECT "type", "quantity", "balanceAfter", "reference", "bucket", "returnReceiptId" FROM "StockMovement" WHERE id = $1', ["movement"])).rows[0];
    expect(movement).toEqual({ type: "RETURN", quantity: 2, balanceAfter: 7, reference: "legacy-reference", bucket: "SELLABLE", returnReceiptId: null });
    expect((await migrated.query('SELECT "status" FROM "ReturnRequest" WHERE id = $1', ["return"])).rows[0].status).toBe("RESTOCKED");
    expect(Number((await migrated.query('SELECT count(*) AS count FROM "ReturnReceipt"')).rows[0].count)).toBe(0);
    expect((await migrated.query('SELECT "attributes" FROM "OrderItem" WHERE id = $1', ["item"])).rows[0].attributes).toEqual({ Size: "M" });
  });

  it("matches the current-schema fixture's tables, columns, enums, indexes and constraints", async () => {
    const actual = await catalog(migrated);
    const expected = await catalog(reference);
    expect(actual.tables).toEqual(expected.tables);
    expect(actual.columns).toEqual(expected.columns);
    expect(actual.enums).toEqual(expected.enums);
    expect(actual.constraints).toEqual(expected.constraints);
    expect(actual.indexes).toEqual(expected.indexes);
  });

  it("bootstraps an empty migrated database once, without public credentials or demo data", async () => {
    const credentials = { SEED_OWNER_EMAIL: "fresh-owner@fixture.invalid", SEED_OWNER_PASSWORD: "fixture-unique-password-123" };
    await expect(seed(freshPrisma, {})).rejects.toThrow(/SEED_OWNER_EMAIL/);
    expect(Number((await fresh.query('SELECT count(*) AS count FROM "User"')).rows[0].count)).toBe(0);
    await expect(seed(freshPrisma, credentials)).resolves.toEqual({ email: credentials.SEED_OWNER_EMAIL, includeDemo: false });
    const owner = await freshPrisma.user.findUniqueOrThrow({ where: { email: credentials.SEED_OWNER_EMAIL }, include: { roles: { include: { role: true } } } });
    expect(await bcrypt.compare(credentials.SEED_OWNER_PASSWORD, owner.passwordHash)).toBe(true);
    expect(owner.roles.map(({ role }) => role.key)).toContain("OWNER");
    expect(await freshPrisma.product.count()).toBe(0);
    expect(await freshPrisma.paymentMethodConfiguration.findUnique({ where: { code: "cod" } })).toMatchObject({ enabled: true, visible: true });
    await expect(seed(freshPrisma, credentials)).rejects.toThrow(/new, empty installation/);
    expect(await freshPrisma.user.count()).toBe(1);
    await expect(seed(existingPrisma, credentials)).rejects.toThrow(/new, empty installation/);
    expect(Number((await migrated.query('SELECT count(*) AS count FROM "Role"')).rows[0].count)).toBe(0);
  }, 60_000);

  it("creates the optional demo and matching opening stock ledger in one bootstrap", async () => {
    await seed(demoPrisma, { SEED_OWNER_EMAIL: "demo-owner@fixture.invalid", SEED_OWNER_PASSWORD: "another-fixture-password-123", SEED_INCLUDE_DEMO: "true" });
    const product = await demoPrisma.product.findUniqueOrThrow({ where: { slug: "premium-cotton-t-shirt" },
      include: { variants: { include: { movements: true } }, landingPage: true } });
    expect(product.landingPage?.status).toBe("PUBLISHED");
    expect(product.variants).toHaveLength(3);
    for (const variant of product.variants) {
      expect(variant.movements).toHaveLength(1);
      expect(variant.movements[0]).toMatchObject({ type: "PURCHASE", bucket: "SELLABLE", quantity: variant.stock, balanceAfter: variant.stock });
    }
  }, 60_000);

  it("enforces nonnegative damaged stock and valid, nonduplicated receipt movements", async () => {
    await expect(migrated.query('UPDATE "ProductVariant" SET "damagedStock" = -1 WHERE id = $1', ["variant"])).rejects.toThrow();
    await expect(migrated.query(`INSERT INTO "ReturnReceipt" (id, "orderId", "returnRequestId", "orderItemId", "receivedQuantity")
      VALUES ('bad-receipt', 'order', 'return', 'item', 0)`)).rejects.toThrow();
    await expect(migrated.query(`INSERT INTO "ReturnReceipt" (id, "orderId", "returnRequestId", "orderItemId", "receivedQuantity",
      "sellableQuantity", "damagedQuantity", "inspectedAt") VALUES ('bad-split', 'order', 'return', 'item', 2, 2, 1, CURRENT_TIMESTAMP)`)).rejects.toThrow();
    await migrated.query(`INSERT INTO "ReturnReceipt" (id, "orderId", "returnRequestId", "orderItemId", "receivedQuantity")
      VALUES ('receipt', 'order', 'return', 'item', 2)`);
    await expect(migrated.query(`INSERT INTO "StockMovement" (id, "productId", "variantId", type, bucket, quantity, "balanceAfter", "returnReceiptId", reference)
      VALUES ('bad-movement', 'product', 'variant', 'RETURN', 'DAMAGED', -1, 0, 'receipt', 'order')`)).rejects.toThrow();
    await migrated.query(`INSERT INTO "StockMovement" (id, "productId", "variantId", type, bucket, quantity, "balanceAfter", "returnReceiptId", reference)
      VALUES ('receipt-movement', 'product', 'variant', 'RETURN', 'DAMAGED', 1, 1, 'receipt', 'order')`);
    await expect(migrated.query(`INSERT INTO "StockMovement" (id, "productId", "variantId", type, bucket, quantity, "balanceAfter", "returnReceiptId", reference)
      VALUES ('duplicate-movement', 'product', 'variant', 'RETURN', 'DAMAGED', 1, 2, 'receipt', 'order')`)).rejects.toThrow();
  });

  it("rolls back all Phase 1 DDL if a conflicting table makes the migration fail", async () => {
    await expect(broken.query(phase1Sql)).rejects.toThrow();
    await broken.query("ROLLBACK");
    const { rows } = await broken.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ProductVariant' AND column_name = 'damagedStock') AS column_exists,
        EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typname = 'StockBucket') AS type_exists
    `);
    expect(rows[0]).toEqual({ column_exists: false, type_exists: false });
  });

  it("protects owner roles and enforces temporary-password changes and one-time resets", async () => {
    const ownerEmail = "fresh-owner@fixture.invalid";
    const temporary = "fixture-temporary-password-123";
    const privatePassword = "fixture-new-private-password-123";
    const staffEmail = "new-staff@fixture.invalid";
    const owner = await freshPrisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const ownerRole = await freshPrisma.role.findUniqueOrThrow({ where: { key: "OWNER" } });
    const viewerRole = await freshPrisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });
    await login(ownerEmail, "fixture-unique-password-123");

    const create = (email: string, roleId: string) => {
      const input = new FormData();
      input.set("name", "Fixture Staff"); input.set("email", email); input.set("password", temporary); input.append("roleIds", roleId);
      return input;
    };
    // A role form submits IDs. A forged OWNER ID must not create an owner.
    await expect(createStaffAction(create("forged-owner@fixture.invalid", ownerRole.id))).rejects.toThrow(/TEST_REDIRECT:.*error=/);
    expect(await freshPrisma.user.findUnique({ where: { email: "forged-owner@fixture.invalid" } })).toBeNull();
    await expect(createStaffAction(create(staffEmail, viewerRole.id))).rejects.toThrow(/TEST_REDIRECT:.*success=/);
    const staff = await freshPrisma.user.findUniqueOrThrow({ where: { email: staffEmail }, include: { roles: { include: { role: true } } } });
    expect(staff.mustResetPassword).toBe(true);
    expect(staff.roles.map((entry) => entry.role.key)).toEqual(["VIEWER"]);

    const forged = new FormData(); forged.set("id", staff.id); forged.set("isActive", "on"); forged.append("roleIds", ownerRole.id);
    await expect(updateStaffRolesAction(forged)).rejects.toThrow(/TEST_REDIRECT:.*error=/);
    expect((await freshPrisma.userRole.findMany({ where: { userId: staff.id }, include: { role: true } })).map((entry) => entry.role.key)).toEqual(["VIEWER"]);
    const ownerEdit = new FormData(); ownerEdit.set("id", owner.id); ownerEdit.set("isActive", "on"); ownerEdit.append("roleIds", viewerRole.id);
    await expect(updateStaffRolesAction(ownerEdit)).rejects.toThrow(/TEST_REDIRECT:.*error=/);
    const ownerReset = new FormData(); ownerReset.set("id", owner.id); ownerReset.set("password", temporary);
    await expect(resetStaffPasswordAction(ownerReset)).rejects.toThrow(/TEST_REDIRECT:.*error=/);
    expect(await freshPrisma.user.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({ isActive: true, passwordHash: owner.passwordHash });
    expect((await freshPrisma.userRole.findMany({ where: { userId: owner.id }, include: { role: true } })).map((entry) => entry.role.key)).toEqual(["OWNER"]);

    authFixture.token = null;
    await login(staffEmail, temporary);
    expect((await getCurrentUser())?.mustResetPassword).toBe(true);
    await expect(requirePermission(PERMISSIONS.DASHBOARD_VIEW)).rejects.toThrow("TEST_REDIRECT:/change-password");
    expect((await exportOrders(new Request("http://fixture.invalid/api/orders/export"))).status).toBe(403);
    expect((await listMedia(new Request("http://fixture.invalid/api/media"))).status).toBe(403);
    const change = new FormData(); change.set("currentPassword", temporary); change.set("newPassword", privatePassword);
    expect(await changePasswordAction(undefined, change)).toEqual({ message: "Password updated" });
    expect((await getCurrentUser())?.mustResetPassword).toBe(false);
    expect((await requirePermission(PERMISSIONS.DASHBOARD_VIEW)).id).toBe(staff.id);

    // Two distinct outstanding links race; at most one can change the password.
    const first = await createPasswordResetToken(staffEmail);
    const second = await createPasswordResetToken(staffEmail);
    if (!first || !second) throw new Error("Fixture reset tokens were not created");
    const reset = await Promise.allSettled([
      consumePasswordResetToken(first, "fixture-reset-password-one"),
      consumePasswordResetToken(second, "fixture-reset-password-two"),
    ]);
    expect(reset.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(reset.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await freshPrisma.passwordResetToken.count({ where: { userId: staff.id, usedAt: null } })).toBe(0);
    expect(await getCurrentUser()).toBeNull();
  }, 60_000);

  it("rejects an old-password login whose account was reset after the initial read", async () => {
    authFixture.token = null;
    const email = "racing-login-reset@fixture.invalid";
    const oldPassword = "fixture-old-password-123";
    const user = await freshPrisma.user.create({ data: { name: "Fixture", email, passwordHash: await bcrypt.hash(oldPassword, 12) } });
    const resetToken = await createPasswordResetToken(email);
    if (!resetToken) throw new Error("Fixture reset token was not created");
    const paused = pauseNextAuthUserRead();
    const outcome = login(email, oldPassword).then(() => ({ status: "fulfilled" }), (error: unknown) => ({ status: "rejected", error }));
    try {
      await paused.read;
      await consumePasswordResetToken(resetToken, "fixture-new-password-123");
    } finally { paused.resume(); }
    expect(await outcome).toMatchObject({ status: "rejected", error: { code: "UNAUTHORIZED", status: 401 } });
    expect(await freshPrisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(authFixture.token).toBeNull();
  }, 60_000);

  it("does not create a revivable session after an account is deactivated", async () => {
    authFixture.token = null;
    const email = "racing-login-disable@fixture.invalid";
    const password = "fixture-old-password-123";
    const user = await freshPrisma.user.create({ data: { name: "Fixture", email, passwordHash: await bcrypt.hash(password, 12) } });
    const paused = pauseNextAuthUserRead();
    const outcome = login(email, password).then(() => ({ status: "fulfilled" }), (error: unknown) => ({ status: "rejected", error }));
    try {
      await paused.read;
      // Simulate the same atomic disable/revocation as staff management.
      await freshPrisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      });
    } finally { paused.resume(); }
    expect(await outcome).toMatchObject({ status: "rejected", error: { code: "UNAUTHORIZED", status: 401 } });
    await freshPrisma.user.update({ where: { id: user.id }, data: { isActive: true } });
    expect(await freshPrisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await getCurrentUser()).toBeNull();
  }, 60_000);

  it("does not issue a stale reset link after another reset revoked earlier links", async () => {
    const email = "racing-reset-issue@fixture.invalid";
    const user = await freshPrisma.user.create({ data: { name: "Fixture", email, passwordHash: await bcrypt.hash("fixture-old-password-123", 12) } });
    const first = await createPasswordResetToken(email);
    if (!first) throw new Error("Fixture reset token was not created");
    const paused = pauseNextAuthUserRead();
    const outcome = createPasswordResetToken(email);
    try {
      await paused.read;
      await consumePasswordResetToken(first, "fixture-new-password-123");
    } finally { paused.resume(); }
    expect(await outcome).toBeNull();
    expect(await freshPrisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
  }, 60_000);
});
