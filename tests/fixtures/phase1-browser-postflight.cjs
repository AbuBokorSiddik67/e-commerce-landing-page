/* Read-only database postflight after all three matching browser smokes.
 * The cluster directory MUST be the one printed by the opt-in browser harness;
 * this never uses DATABASE_URL and refuses an unidentified PostgreSQL process.
 * No credentials or checkout capabilities are printed. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Client } = require("pg");

async function main() {
  if (process.env.LANDIQ_PHASE1_BROWSER_DISPOSABLE !== "1") throw new Error("Explicit disposable browser opt-in is required");
  const root = path.resolve("tmp");
  const infoPath = path.resolve(process.env.LANDIQ_BROWSER_INFO_FILE ?? "");
  const scratch = path.resolve(process.env.LANDIQ_BROWSER_CLUSTER_DIRECTORY ?? "");
  if (path.dirname(infoPath) !== root || !/^phase1-browser-[a-z0-9-]+\.json$/.test(path.basename(infoPath))
    || path.dirname(scratch) !== root || !/^phase1-browser-cluster-[a-zA-Z0-9]{6}$/.test(path.basename(scratch))) {
    throw new Error("Explicit browser metadata and harness-created cluster paths are required");
  }
  if (path.dirname(fs.realpathSync(scratch)) !== fs.realpathSync(root)) throw new Error("Unexpected cluster realpath");
  const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
  const data = JSON.parse(fs.readFileSync(path.join(scratch, "browser-private.json"), "utf8"));
  const config = data.config;
  const dataDir = path.join(scratch, "data");
  const pid = fs.readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split("\n");
  if (info.state !== "ready" || !Number.isInteger(info.pid) || !Number.isInteger(data.pgPid) || !Number.isInteger(config?.port)
    || !info.managerEmail?.endsWith("@fixture.invalid") || !info.viewerEmail?.endsWith("@fixture.invalid")
    || config.host !== "127.0.0.1" || !/^browser_[a-f0-9]{20}$/.test(config.user ?? "")
    || !/^browser_[a-f0-9]{20}$/.test(config.database ?? "") || data.scratch !== scratch
    || fs.realpathSync(data.directory) !== fs.realpathSync(dataDir) || Number(pid[0]) !== data.pgPid
    || fs.realpathSync(pid[1]) !== fs.realpathSync(dataDir) || Number(pid[3]) !== config.port
    || pid[4] !== scratch || pid[5] !== "127.0.0.1") throw new Error("Refusing unidentified browser database");
  process.kill(info.pid, 0); process.kill(data.pgPid, 0);
  const harnessCommand = fs.readFileSync(`/proc/${info.pid}/cmdline`, "utf8").split("\0");
  const postgresCommand = fs.readFileSync(`/proc/${data.pgPid}/cmdline`, "utf8").split("\0");
  const dataArg = postgresCommand.indexOf("-D");
  if (!harnessCommand.some((part) => part.endsWith("tests/fixtures/phase1-browser-harness.cjs"))
    || path.basename(fs.readlinkSync(`/proc/${data.pgPid}/exe`)) !== "postgres" || dataArg < 0
    || fs.realpathSync(postgresCommand[dataArg + 1]) !== fs.realpathSync(dataDir)) throw new Error("Browser process identity mismatch");
  const db = new Client({ ...config, options: "-c default_transaction_read_only=on" });
  await db.connect();
  try {
    const one = async (sql, values = []) => { const result = await db.query(sql, values); assert.equal(result.rowCount, 1); return result.rows[0]; };
    const actual = await one(`SELECT current_setting('data_directory') AS dir, current_database()::text AS db,
      current_user::text AS usr, host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_schema()::text AS schema, current_setting('transaction_read_only') AS ro`);
    assert.equal(fs.realpathSync(actual.dir), fs.realpathSync(dataDir)); assert.equal(actual.db, config.database);
    assert.equal(actual.usr, config.user); assert.equal(actual.host, config.host); assert.equal(actual.port, config.port);
    assert.equal(actual.schema, "public"); assert.equal(actual.ro, "on");
    const manager = await one('SELECT id FROM "User" WHERE email=$1', [info.managerEmail]);
    const viewer = await one('SELECT id FROM "User" WHERE email=$1', [info.viewerEmail]);

    const receipt = await one(`SELECT r.id,r."receivedQuantity",r."sellableQuantity",r."damagedQuantity",
      r."receivedById",r."inspectedById",r."inspectedAt" IS NOT NULL AS inspected,v.stock,v."damagedStock"
      FROM "ReturnReceipt" r JOIN "Order" o ON o.id=r."orderId" JOIN "ProductVariant" v ON v.id=o."variantId" WHERE o.id=$1`, [info.orderId]);
    assert.deepEqual({ ...receipt, id: undefined }, { id: undefined, receivedQuantity: 2, sellableQuantity: 1, damagedQuantity: 1,
      receivedById: manager.id, inspectedById: manager.id, inspected: true, stock: 2, damagedStock: 1 });
    const receiptMovements = await db.query('SELECT bucket,quantity FROM "StockMovement" WHERE "returnReceiptId"=$1 ORDER BY bucket::text', [receipt.id]);
    assert.deepEqual(receiptMovements.rows, [{ bucket: "DAMAGED", quantity: 1 }, { bucket: "SELLABLE", quantity: 1 }]);
    const checkout = await one('SELECT stock,"damagedStock" FROM "ProductVariant" WHERE id=$1', [info.checkoutVariantId]);
    assert.deepEqual(checkout, { stock: 0, damagedStock: 0 });
    const checkoutOrder = await one('SELECT id,quantity FROM "Order" WHERE "productId"=$1', [info.checkoutProductId]);
    assert.equal(checkoutOrder.quantity, 2);
    const checkoutMovement = await one('SELECT quantity FROM "StockMovement" WHERE reference=$1 AND type=$2', [checkoutOrder.id, "SALE"]);
    assert.equal(checkoutMovement.quantity, -2);

    const finance = await one(`SELECT "paymentStatus","financialStatus","settlementStatus","codCollectedAt" IS NOT NULL AS collected,
      "codSettledAt" IS NOT NULL AS settled,"internalNote" FROM "Order" WHERE id=$1`, [info.financeOrderId]);
    assert.deepEqual(finance, { paymentStatus: "COD_COLLECTED", financialStatus: "PARTIALLY_SETTLED", settlementStatus: "SETTLED",
      collected: true, settled: true, internalNote: "Synthetic authorized manager note" });
    const refund = await one('SELECT mode,status,amount,"createdById" FROM "Refund" WHERE "orderId"=$1', [info.financeOrderId]);
    assert.deepEqual(refund, { mode: "INTERNAL", status: "RECORDED", amount: 100, createdById: manager.id });
    const adjustment = await one('SELECT v.stock,v."damagedStock" FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" WHERE p.name=$1', ["Browser Adjustment Item"]);
    assert.deepEqual(adjustment, { stock: 3, damagedStock: 0 });
    const movement = await one('SELECT m.quantity,m."createdById" FROM "StockMovement" m JOIN "Product" p ON p.id=m."productId" WHERE p.name=$1 AND m.type=$2', ["Browser Adjustment Item", "ADJUSTMENT"]);
    assert.deepEqual(movement, { quantity: 2, createdById: manager.id });

    const delivery = await one(`SELECT d.id,d.status,o.status AS orderstatus,v.stock,v."damagedStock" FROM "OwnDelivery" d
      JOIN "Order" o ON o.id=d."orderId" JOIN "ProductVariant" v ON v.id=o."variantId" WHERE o.id=$1`, [info.deliveryOrderId]);
    assert.equal(delivery.status, "RETURNED"); assert.equal(delivery.orderstatus, "SHIPPED");
    assert.equal(delivery.stock, 1); assert.equal(delivery.damagedStock, 0);
    const events = await db.query('SELECT status,"actorId" FROM "OwnDeliveryEvent" WHERE "deliveryId"=$1', [delivery.id]);
    assert.deepEqual(events.rows.map((event) => event.status).sort(), ["ASSIGNED", "DISPATCHED", "RETURNED", "RETURNING"]);
    assert(events.rows.every((event) => event.actorId === manager.id));
    const otherMovements = await one('SELECT count(*)::int AS n FROM "StockMovement" WHERE reference=$1 AND type<>$2', [info.deliveryOrderId, "SALE"]);
    assert.equal(otherMovements.n, 0);

    const shipment = async (orderId) => one(`SELECT s.id,s.status,s."consignmentId",s."trackingId",s.payload,v.stock,v."damagedStock"
      FROM "CourierShipment" s JOIN "Order" o ON o.id=s."orderId" JOIN "ProductVariant" v ON v.id=o."variantId" WHERE o.id=$1`, [orderId]);
    const rejected = await shipment(info.courierOrderId);
    assert.equal(rejected.status, "PENDING"); assert.equal(rejected.consignmentId, null); assert.equal(rejected.trackingId, null);
    assert.equal(rejected.payload.landiqBooking.state, "OUTCOME_UNKNOWN"); assert.equal(rejected.payload.landiqStaffRejection.kind, "STAFF_REPORTED_REJECTION");
    assert.equal(rejected.stock, 1); assert.equal(rejected.damagedStock, 0);
    const known = await shipment(info.knownCourierOrderId);
    assert.equal(known.status, "BOOKED"); assert.equal(known.consignmentId, "synthetic-known-consignment"); assert.equal(known.trackingId, "synthetic-known-tracking");
    assert.equal(known.payload.landiqStaffResolution.kind, "BOOKING_RECORDED"); assert.equal(known.stock, 1); assert.equal(known.damagedStock, 0);
    const operations = await one('SELECT count(*)::int AS n FROM "CourierOperation" WHERE "shipmentId"=ANY($1::text[])', [[rejected.id, known.id]]);
    assert.equal(operations.n, 0);
    const viewerWrites = await one('SELECT count(*)::int AS n FROM "AuditLog" WHERE "actorId"=$1 AND action<>$2', [viewer.id, "LOGIN"]);
    assert.equal(viewerWrites.n, 0);
    const expected = { COD_COLLECTED: 1, COD_SETTLED: 1, RECORD_REFUND: 1, OWN_DELIVERY_ASSIGNED: 1, OWN_DELIVERY_EVENT: 3,
      COURIER_REJECTION_STAFF_REPORTED: 1, COURIER_BOOKING_STAFF_RECORDED: 1, RETURN_RECEIVED: 1, RETURN_INSPECTED: 1 };
    const actions = await db.query('SELECT action,count(*)::int AS n FROM "AuditLog" WHERE "actorId"=$1 AND action=ANY($2::text[]) GROUP BY action', [manager.id, Object.keys(expected)]);
    assert.deepEqual(Object.fromEntries(actions.rows.map((row) => [row.action, row.n])), expected);
    console.info("Read-only identity-verified browser postflight PASS: checkout, receipt ledger, finance, adjustment, delivery, courier evidence and viewer audit");
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
