// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Opt in explicitly. This suite NEVER uses DATABASE_URL: it creates its own
// cluster in a fresh, uniquely named tmp directory and verifies its identity
// before issuing any fixture DDL or record writes. No migrations, db push,
// resetDatabase, or existing installation data are used.
const enabled = process.env.LANDIQ_DISPOSABLE_PG_TEST === "1";
const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get(_target, key) {
      if (!state.client) throw new Error("Disposable test database is not initialized");
      const value: unknown = Reflect.get(state.client, key, state.client);
      return typeof value === "function" ? value.bind(state.client) : value;
    },
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn().mockResolvedValue({ id: "fixture-actor" }),
  requirePageAccess: vi.fn().mockResolvedValue({ id: "fixture-viewer" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => { throw new Error(`TEST_REDIRECT:${location}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import { deleteCategoryAction, saveProductAction } from "@/app/actions/products";
import EditProduct from "@/app/dashboard/products/[id]/page";
import { adjustStock, setStock } from "@/services/inventory";
import { createProduct, setProductStatus, updateProduct, type ProductInput } from "@/services/products";

type ProductDetails = Prisma.ProductGetPayload<{ include: { variants: { include: { _count: { select: { movements: true } } } }; images: true } }>;
let postgres: EmbeddedPostgres | undefined;
let started = false;
let scratch: string | undefined;

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
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not obtain an isolated PostgreSQL port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForBlockedQuery(fragment: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await db().$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}
      ) AS "blocked"
    `;
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for a PostgreSQL lock on ${fragment}`);
}

async function createFixtureProduct(categoryId?: string, variantCount = 1) {
  return createProduct({
    name: "Fixture shirt", slug: `fixture-${randomUUID()}`, regularPrice: 500,
    categoryId, dimensions: { length: 10, width: 2.5, height: 3 },
    images: [{ url: "https://example.test/fixture.png" }],
    variants: Array.from({ length: variantCount }, (_, index) => ({
      name: index === 0 ? "Medium" : `Size ${index}`, stock: 7 + index,
      attributes: [{ name: "Color", value: "Blue" }],
    })),
  });
}

async function loadProduct(id: string) {
  return db().product.findUniqueOrThrow({
    where: { id }, include: { variants: { orderBy: { position: "asc" }, include: { _count: { select: { movements: true } } } },
      images: { orderBy: { position: "asc" } } },
  });
}

function editInput(product: ProductDetails): ProductInput {
  return {
    name: product.name, slug: product.slug, sku: product.sku,
    shortDescription: product.shortDescription, description: product.description,
    regularPrice: product.regularPrice, salePrice: product.salePrice,
    categoryId: product.categoryId, expectedCategoryId: product.categoryId,
    status: product.status, expectedStatus: product.status, isFeatured: product.isFeatured, videoUrl: product.videoUrl, weightGrams: product.weightGrams,
    images: product.images.map((image) => ({ url: image.url, alt: image.alt ?? undefined, kind: image.kind === "VIDEO" ? "VIDEO" : "IMAGE" })),
    variants: product.variants.map((variant) => ({
      id: variant.id, name: variant.name, sku: variant.sku, price: variant.price, stock: variant.stock,
      lowStockThreshold: variant.lowStockThreshold, imageUrl: variant.imageUrl, isActive: variant.isActive, position: variant.position,
      expectedStock: variant.stock, expectedMovementCount: variant._count.movements,
      expectedUpdatedAt: variant.updatedAt.toISOString(), expectedAttributes: variant.attributes,
    })),
  };
}

async function submit(form: FormData, action = saveProductAction) {
  try {
    await action(form);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TEST_REDIRECT:")) {
      return new URL(error.message.slice("TEST_REDIRECT:".length), "http://test.invalid");
    }
    throw error;
  }
  throw new Error("Expected redirect");
}

describe.skipIf(!enabled)("product preservation on a fresh disposable PostgreSQL fixture", () => {
  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "tmp");
    await mkdir(root, { recursive: true });
    scratch = await mkdtemp(path.join(root, "phase11-postgres-"));
    const directory = path.join(scratch, "data");
    const port = await freePort();
    const user = `fixture_${randomBytes(8).toString("hex")}`;
    const password = randomBytes(24).toString("hex");
    postgres = new EmbeddedPostgres({
      databaseDir: directory, port, user, password, persistent: false, autoRehydrateSymlinks: true,
      postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", `unix_socket_directories=${scratch}`],
      onLog: () => {}, onError: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    started = true;
    // Refuse to contact a different listener if the selected port was taken.
    const postmaster = (await readFile(path.join(directory, "postmaster.pid"), "utf8")).split("\n");
    const spawned = (postgres as unknown as { process?: { pid?: number } }).process?.pid;
    if (!spawned || Number(postmaster[0]) !== spawned || await realpath(postmaster[1]) !== await realpath(directory)
      || Number(postmaster[3]) !== port || postmaster[4] !== scratch || postmaster[5] !== "127.0.0.1") {
      throw new Error("Refusing to connect: local PostgreSQL process identity mismatch");
    }
    const database = `product_${randomBytes(8).toString("hex")}`;
    const makeClient = (name: string) => new PrismaClient({ adapter: new PrismaPg({
      host: "127.0.0.1", port, user, password, database: name, ssl: false,
    }) });
    const identify = async (client: PrismaClient) => {
      const [value] = await client.$queryRaw<Array<{ directory: string; database: string; username: string; port: number; host: string; schema: string }>>`
        SELECT current_setting('data_directory') AS "directory", current_database()::text AS "database",
          current_user::text AS "username", inet_server_port() AS "port", host(inet_server_addr()) AS "host", current_schema()::text AS "schema"
      `;
      return value;
    };
    const matches = async (value: Awaited<ReturnType<typeof identify>>, expectedDatabase: string) =>
      Boolean(value && await realpath(value.directory) === await realpath(directory) && value.database === expectedDatabase
        && value.username === user && value.port === port && value.host === "127.0.0.1" && value.schema === "public");
    const admin = makeClient("postgres");
    try {
      if (!(await matches(await identify(admin), "postgres")) || !/^product_[a-f0-9]{16}$/.test(database)) {
        throw new Error("Refusing to create a test database on an unverified cluster");
      }
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    } finally {
      await admin.$disconnect();
    }
    state.client = makeClient(database);
    const identity = await identify(db());
    if (!(await matches(identity, database))) throw new Error("Refusing to write to an unverified database");
    const [empty] = await db().$queryRaw<Array<{ tables: bigint; types: bigint }>>`
      SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')) AS "tables",
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype IN ('e', 'c', 'd')) AS "types"
    `;
    if (Number(empty.tables) || Number(empty.types)) throw new Error("Refusing fixture DDL: database is not empty");
    console.info("Verified disposable product PostgreSQL identity", { host: "127.0.0.1", port, database, schema: "public", user, directory });
    // Use the same current-schema, CREATE-only fixture as the Phase 1 suites.
    // The former partial fixture did not contain the new stock columns.
    const fixture = await readFile(path.join(process.cwd(), "tests/fixtures/phase1-disposable-schema.sql"), "utf8");
    const statements = fixture.replace(/^--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean);
    if (!statements.length || statements.some((sql) => !/^CREATE\s+(?:TYPE|TABLE|(?:UNIQUE\s+)?INDEX)\s/i.test(sql))) {
      throw new Error("Refusing non-CREATE-only fixture SQL");
    }
    for (const statement of statements) await db().$executeRawUnsafe(statement);
    await db().user.create({ data: { id: "fixture-actor", name: "Fixture actor", email: "product-fixture@fixture.invalid", passwordHash: "not-a-login" } });
  }, 60_000);

  afterEach(cleanup);
  afterAll(async () => {
    try {
      await state.client?.$disconnect();
    } finally {
      if (started) await postgres?.stop();
      // This path was created by mkdtemp above; it is never .postgres-data.
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("round-trips the rendered editor while retaining real variant, order, movement, reservation, category and dimension relationships", async () => {
    const category = await db().category.create({ data: { name: "Hidden", slug: `category-${randomUUID()}` } });
    const created = await createFixtureProduct(category.id);
    await db().category.update({ where: { id: category.id }, data: { isActive: false } });
    const legacy = { "  Size,:\t": " M, tall: regular  ", "Line\r\nname": "first\r\nsecond" };
    await db().productVariant.update({ where: { id: created.variants[0].id }, data: { attributes: legacy } });
    const orderId = `order-${randomUUID()}`;
    const customer = await db().customer.create({ data: { name: "Fixture buyer", phone: "01700000000" } });
    await db().order.create({ data: {
      id: orderId, orderNumber: `fixture-${randomUUID()}`, customerId: customer.id, productId: created.id,
      quantity: 1, subtotal: 500, total: 500, address: "Fixture address", district: "Rajshahi", trackingToken: randomUUID(),
    } });
    const item = await db().orderItem.create({ data: {
      orderId, variantId: created.variants[0].id, name: "Original snapshot", unitPrice: 500, quantity: 1, lineTotal: 500, attributes: legacy,
    } });
    const reservation = await db().stockReservation.create({ data: {
      orderId, variantId: created.variants[0].id, quantity: 1, expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    } });
    const movement = await db().stockMovement.findFirstOrThrow({ where: {
      productId: created.id, variantId: created.variants[0].id, type: "PURCHASE", quantity: 7, balanceAfter: 7,
    } });

    const { container, unmount } = render(await EditProduct({ params: Promise.resolve({ id: created.id }) }));
    expect(screen.getByLabelText("Category")).toHaveValue(category.id);
    expect(screen.getByRole("option", { name: /Hidden.*inactive/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: "Updated fixture shirt" } });
    const group = within(screen.getByRole("group", { name: "Attributes for Medium" }));
    fireEvent.change(group.getAllByLabelText("Attribute value")[0], { target: { value: " XL,: wide \t" } });
    fireEvent.change(group.getAllByLabelText("Attribute value")[1], { target: { value: "first\nsecond!" } });
    fireEvent.click(group.getByRole("button", { name: "Add attribute to Medium" }));
    fireEvent.change(group.getAllByLabelText(/^Attribute name/)[2], { target: { value: " Color, : " } });
    fireEvent.change(group.getAllByLabelText("Attribute value")[2], { target: { value: " Navy: blue, \t" } });
    const form = container.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("Expected product form");
    expect((await submit(new FormData(form))).searchParams.get("success")).toBe("Product updated");

    const saved = await loadProduct(created.id);
    const expected = [
      { name: "  Size,:\t", value: " XL,: wide \t" },
      { name: "Line\r\nname", value: "first\r\nsecond!" },
      { name: " Color, : ", value: " Navy: blue, \t" },
    ];
    expect(saved).toMatchObject({ id: created.id, name: "Updated fixture shirt", categoryId: category.id, dimensions: { length: 10, width: 2.5, height: 3 } });
    expect(saved.variants[0]).toMatchObject({ id: created.variants[0].id, productId: created.id, stock: 7, attributes: expected });
    expect(await db().orderItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ variantId: created.variants[0].id, attributes: legacy });
    expect(await db().stockReservation.findUniqueOrThrow({ where: { id: reservation.id } })).toMatchObject({ variantId: created.variants[0].id, orderId });
    expect(await db().stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).toMatchObject({ productId: created.id, variantId: created.variants[0].id, quantity: 7 });
    expect(await db().stockMovement.count({ where: { productId: created.id } })).toBe(1);
    unmount();
    render(await EditProduct({ params: Promise.resolve({ id: created.id }) }));
    expect(within(screen.getByRole("group", { name: "Attributes for Medium" })).getAllByLabelText("Attribute value")
      .map((element) => (element as HTMLTextAreaElement).value)).toEqual([" XL,: wide \t", "first\nsecond!", " Navy: blue, \t"]);
  });

  it("preserves omitted legacy attributes and dimensions, and clears only when explicitly requested", async () => {
    const created = await createFixtureProduct();
    const legacy = { Size: " M, tall " };
    await db().productVariant.update({ where: { id: created.variants[0].id }, data: { attributes: legacy } });
    const before = await loadProduct(created.id);
    await updateProduct(created.id, { ...editInput(before), name: "Unrelated edit" });
    const unchanged = await loadProduct(created.id);
    expect(unchanged.variants[0].attributes).toEqual(legacy);
    expect(unchanged.dimensions).toEqual({ length: 10, width: 2.5, height: 3 });
    const input = editInput(unchanged);
    input.variants[0].attributes = [];
    input.dimensions = null;
    await updateProduct(created.id, input);
    const cleared = await loadProduct(created.id);
    expect(cleared.variants[0].attributes).toEqual([]);
    const [row] = await db().$queryRaw<Array<{ cleared: boolean }>>`SELECT "dimensions" IS NULL AS "cleared" FROM "Product" WHERE "id" = ${created.id}`;
    expect(row.cleared).toBe(true);
  });

  it("rejects stale category selections and invalid dimensions without changing the stored product", async () => {
    const created = await createFixtureProduct();
    const stale = editInput(await loadProduct(created.id));
    const category = await db().category.create({ data: { name: "New category", slug: `category-${randomUUID()}` } });
    await db().product.update({ where: { id: created.id }, data: { categoryId: category.id } });
    stale.name = "Must not overwrite category";
    await expect(updateProduct(created.id, stale)).rejects.toThrow(/category changed.*Reload/);
    const current = await loadProduct(created.id);
    expect(current.categoryId).toBe(category.id);
    expect(current.name).toBe(created.name);
    const invalid = editInput(current);
    invalid.dimensions = { length: -1 };
    await expect(updateProduct(created.id, invalid)).rejects.toThrow();
    expect(await loadProduct(created.id)).toEqual(current);
  });

  it("allows active reassignment and removal, then deletes an unused category", async () => {
    const created = await createFixtureProduct();
    const category = await db().category.create({ data: { name: "Available", slug: `available-${randomUUID()}` } });
    const assign = editInput(await loadProduct(created.id));
    assign.categoryId = category.id;
    await updateProduct(created.id, assign);
    expect((await loadProduct(created.id)).categoryId).toBe(category.id);
    const clear = editInput(await loadProduct(created.id));
    clear.categoryId = null;
    await updateProduct(created.id, clear);
    expect((await loadProduct(created.id)).categoryId).toBeNull();
    const form = new FormData();
    form.set("id", category.id);
    expect((await submit(form, deleteCategoryAction)).searchParams.get("success")).toBe("Category deleted");
    expect(await db().category.findUnique({ where: { id: category.id } })).toBeNull();
  });

  it("detects a changed raw attribute value even if its timestamp was not updated", async () => {
    const created = await createFixtureProduct();
    const original = await loadProduct(created.id);
    const id = original.variants[0].id;
    const concurrent = [{ name: "Color", value: "Green, blue" }];
    await db().$executeRaw`UPDATE "ProductVariant" SET "attributes" = ${JSON.stringify(concurrent)}::jsonb WHERE "id" = ${id}`;
    expect((await db().productVariant.findUniqueOrThrow({ where: { id } })).updatedAt).toEqual(original.variants[0].updatedAt);
    const stale = editInput(original);
    stale.name = "Must roll back";
    stale.variants[0].attributes = [{ name: "Color", value: "Red" }];
    await expect(updateProduct(created.id, stale)).rejects.toThrow(/changed.*Reload/);
    const saved = await loadProduct(created.id);
    expect(saved.name).toBe(original.name);
    expect(saved.variants[0].attributes).toEqual(concurrent);
  });

  it("rejects foreign and omitted persisted variants without touching either product", async () => {
    const first = await createFixtureProduct(undefined, 2);
    const foreign = await createFixtureProduct();
    const before = await loadProduct(first.id);
    const foreignBefore = await loadProduct(foreign.id);
    const input = editInput(before);
    input.name = "Must not be saved";
    input.variants.push(editInput(foreignBefore).variants[0]);
    await expect(updateProduct(first.id, input)).rejects.toThrow(/does not belong/);
    const omitted = editInput(before);
    omitted.variants.pop();
    await expect(updateProduct(first.id, omitted)).rejects.toThrow(/cannot be removed/);
    expect(await loadProduct(first.id)).toEqual(before);
    expect(await loadProduct(foreign.id)).toEqual(foreignBefore);
  });

  it("rolls back a stale product edit when a concurrent checkout stock deduction commits", async () => {
    const created = await createFixtureProduct();
    const original = await loadProduct(created.id);
    const locked = deferred();
    const release = deferred();
    const checkout = db().$transaction(async (tx) => {
      await adjustStock(tx, { variantId: original.variants[0].id, delta: -1, type: "SALE", reference: "fixture-checkout" });
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const input = editInput(original);
    input.name = "Must roll back";
    const save = updateProduct(created.id, input).then(() => null, (error: unknown) => error);
    try {
      await waitForBlockedQuery("ProductVariant");
    } finally {
      release.resolve();
    }
    await checkout;
    expect(await save).toEqual(expect.objectContaining({ message: expect.stringMatching(/changed.*Reload/) }));
    const saved = await loadProduct(created.id);
    expect(saved.name).toBe(original.name);
    expect(saved.images).toEqual(original.images);
    expect(saved.variants[0].stock).toBe(6);
    const movements = await db().stockMovement.findMany({ where: { productId: created.id } });
    expect(movements).toHaveLength(2);
    expect(movements).toEqual(expect.arrayContaining([
      expect.objectContaining({ variantId: original.variants[0].id, type: "PURCHASE", quantity: 7, balanceAfter: 7 }),
      expect.objectContaining({ variantId: original.variants[0].id, type: "SALE", quantity: -1, balanceAfter: 6 }),
    ]));
  }, 20_000);

  it("does not let a stale product editor republish a concurrently archived product", async () => {
    const created = await createFixtureProduct();
    await setProductStatus(created.id, "PUBLISHED");
    const snapshot = await loadProduct(created.id);
    const stale = editInput(snapshot);
    stale.name = "Stale editor change";
    await setProductStatus(created.id, "ARCHIVED");
    await expect(updateProduct(created.id, stale)).rejects.toThrow(/status changed.*Reload/);
    const current = await loadProduct(created.id);
    expect(current.status).toBe("ARCHIVED");
    expect(current.name).toBe(snapshot.name);
  });

  it("rechecks the editor status predicate after waiting for a concurrent archive", async () => {
    const created = await createFixtureProduct();
    await setProductStatus(created.id, "PUBLISHED");
    const snapshot = await loadProduct(created.id);
    const stale = editInput(snapshot);
    const locked = deferred();
    const release = deferred();
    const archive = db().$transaction(async (tx) => {
      await tx.product.update({ where: { id: created.id }, data: { status: "ARCHIVED" } });
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const save = updateProduct(created.id, stale).then(() => null, (error: unknown) => error);
    try { await waitForBlockedQuery("Product"); } finally { release.resolve(); }
    await archive;
    expect(await save).toEqual(expect.objectContaining({ message: expect.stringMatching(/status changed.*Reload/) }));
    expect((await loadProduct(created.id)).status).toBe("ARCHIVED");
  }, 20_000);

  it("rejects a stale manual stock adjustment and records a matching adjustment once", async () => {
    const created = await createFixtureProduct();
    const id = created.variants[0].id;
    await db().$transaction((tx) => adjustStock(tx, { variantId: id, delta: -2, type: "SALE" }));
    await expect(setStock(id, 10, 7, 1, "Stale count")).rejects.toThrow(/Stock changed/);
    expect((await db().productVariant.findUniqueOrThrow({ where: { id } })).stock).toBe(5);
    await expect(setStock(id, 8, 5, 2, "Fresh count")).resolves.toBe(8);
    const movements = await db().stockMovement.findMany({ where: { variantId: id } });
    expect(movements).toHaveLength(3);
    expect(movements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "PURCHASE", quantity: 7, balanceAfter: 7 }),
      expect.objectContaining({ type: "SALE", quantity: -2, balanceAfter: 5 }),
      expect.objectContaining({ type: "ADJUSTMENT", quantity: 3, balanceAfter: 8 }),
    ]));
  });

  it("rejects an inventory form after intervening stock movements return the balance to its original value", async () => {
    const created = await createFixtureProduct();
    const id = created.variants[0].id;
    await db().$transaction((tx) => adjustStock(tx, { variantId: id, delta: -1, type: "SALE" }));
    await db().$transaction((tx) => adjustStock(tx, { variantId: id, delta: 1, type: "CANCELLATION" }));
    expect((await db().productVariant.findUniqueOrThrow({ where: { id } })).stock).toBe(7);
    // This form was opened before both movements; the balance alone is an ABA.
    await expect(setStock(id, 10, 7, 1, "Stale count")).rejects.toThrow(/Stock changed/);
    expect((await db().productVariant.findUniqueOrThrow({ where: { id } })).stock).toBe(7);
  });

  it("rechecks the movement snapshot after waiting for a net-zero stock transaction", async () => {
    const created = await createFixtureProduct();
    const id = created.variants[0].id;
    const locked = deferred();
    const release = deferred();
    const writer = db().$transaction(async (tx) => {
      await adjustStock(tx, { variantId: id, delta: -1, type: "SALE" });
      await adjustStock(tx, { variantId: id, delta: 1, type: "CANCELLATION" });
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const adjustment = setStock(id, 10, 7, 1, "Stale count").then(() => null, (error: unknown) => error);
    try { await waitForBlockedQuery("ProductVariant"); } finally { release.resolve(); }
    await writer;
    expect(await adjustment).toEqual(expect.objectContaining({ message: expect.stringMatching(/Stock changed/) }));
    expect((await db().productVariant.findUniqueOrThrow({ where: { id } })).stock).toBe(7);
    expect(await db().stockMovement.count({ where: { variantId: id } })).toBe(3);
  }, 20_000);

  it("rejects a stale product stock edit after an ABA even when the variant timestamp collides", async () => {
    const created = await createFixtureProduct();
    const original = await loadProduct(created.id);
    const stale = editInput(original);
    stale.variants[0].stock = 10;
    const id = original.variants[0].id;
    await db().$transaction((tx) => adjustStock(tx, { variantId: id, delta: -1, type: "SALE" }));
    await db().$transaction((tx) => adjustStock(tx, { variantId: id, delta: 1, type: "CANCELLATION" }));
    // Model two writes sharing the millisecond-precision timestamp used by @updatedAt.
    await db().productVariant.update({ where: { id }, data: { updatedAt: original.variants[0].updatedAt } });
    await expect(updateProduct(created.id, stale)).rejects.toThrow(/changed.*Reload/);
    expect((await loadProduct(created.id)).variants[0].stock).toBe(7);
  });

  it("serializes category deletion with a concurrent assignment before checking for products", async () => {
    const category = await db().category.create({ data: { name: "Delete race", slug: `delete-race-${randomUUID()}` } });
    const slug = `assigned-${randomUUID()}`;
    const locked = deferred();
    const release = deferred();
    const assignment = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "id" = ${category.id} FOR SHARE`;
      await tx.product.create({ data: { name: "Concurrent assignment", slug, regularPrice: 500, categoryId: category.id } });
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const form = new FormData();
    form.set("id", category.id);
    const deletion = submit(form, deleteCategoryAction);
    try {
      await waitForBlockedQuery("FOR UPDATE");
    } finally {
      release.resolve();
    }
    await assignment;
    expect((await deletion).searchParams.get("error")).toMatch(/Move products out/);
    expect(await db().category.findUnique({ where: { id: category.id } })).not.toBeNull();
    expect((await db().product.findUniqueOrThrow({ where: { slug } })).categoryId).toBe(category.id);
  }, 20_000);

  it("waits for concurrent category deactivation and rejects the resulting inactive assignment", async () => {
    const category = await db().category.create({ data: { name: "Race", slug: `race-${randomUUID()}` } });
    const slug = `race-product-${randomUUID()}`;
    const locked = deferred();
    const release = deferred();
    const deactivation = db().$transaction(async (tx) => {
      await tx.category.update({ where: { id: category.id }, data: { isActive: false } });
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const assignment = createProduct({ name: "Race shirt", slug, regularPrice: 500, categoryId: category.id,
      variants: [{ name: "Default", stock: 0, attributes: [] }] }).then(() => null, (error: unknown) => error);
    try {
      await waitForBlockedQuery("FOR SHARE");
    } finally {
      release.resolve();
    }
    await deactivation;
    expect(await assignment).toEqual(expect.objectContaining({ message: expect.stringMatching(/active category/) }));
    expect(await db().product.findUnique({ where: { slug } })).toBeNull();
  }, 20_000);
});
