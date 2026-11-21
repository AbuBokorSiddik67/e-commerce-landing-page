# Phase 1 order, delivery and inventory schema proposal

**PROPOSAL ONLY — NOT A MIGRATION, NOT EXECUTED.** No existing migration is edited. This is a review draft for the current single pre-production codebase and database; it is not an instruction to run SQL. Obtain separate approval before generating, reviewing, or applying a migration. Do not use `db push`, reset, seed, or an unidentified database.

## Impact and assumptions

- `ProductVariant.stock` remains the sellable balance. `damagedStock` starts at zero and is not available for checkout. Historical movements default to the `SELLABLE` bucket; this does **not** assert anything about the condition of historic returns.
- Cancellation reason and automatic-release timestamp are nullable. Existing cancelled orders remain unclassified; do not infer that their stock was or was not released from the new timestamp alone.
- `ReturnReceipt` records a quantity physically received against an existing order item and return request. Inspection splits that quantity into sellable and damaged amounts once. The unique receipt/bucket movement key prevents a second posting of the same bucket. Existing whole-order return records are not backfilled; ambiguous prior movements must be reviewed, not repeated.
- `OwnDelivery` stores one current shop-delivery assignment per order and append-only events retain reassignment and physical-delivery history. Its `RETURNED` event is not a warehouse receipt. Restrictive foreign keys intentionally prevent deleting evidence-bearing orders, items, receipts, delivery events, or shipments through cascades.
- `CourierOperation` stores one cancellation attempt per shipment. Pending/unknown operations do not expire and are not automatically retried. Staff-reported provider evidence is not physical stock evidence. Before a staff report marks a shipment cancelled, an operation-bound snapshot of its prior local status is retained in the shipment's existing JSON payload; this is not a provider-verified current status.
- Order locks serialize current application writers; the database unique constraints are an additional defense. Cross-row item caps and validation of historical movement evidence are enforced by the service while holding the order lock; the SQL checks below protect local row shape.
- No data repair, provider call, or destructive operation is part of this proposal. Test existing historical data, query plans, permissions, and constraint compatibility on an explicitly verified disposable database before seeking approval for any real schema change. The current native Prisma engine download is blocked by TLS in this environment.

## Illustrative additive PostgreSQL DDL

The exact generated Prisma migration and constraint names must be reviewed against the actual schema and migration history before approval. This draft has **not** been executed or validated as a migration against PostgreSQL. A separate CREATE-only, schema-derived fixture was exercised on a new disposable cluster; its six local CHECK expressions statically match this draft, but those fixture results do not establish that the ALTER statements or existing data are compatible.

```sql
CREATE TYPE "StockBucket" AS ENUM ('SELLABLE', 'DAMAGED');
CREATE TYPE "OwnDeliveryStatus" AS ENUM
  ('ASSIGNED', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'FAILED', 'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED');

ALTER TABLE "ProductVariant" ADD COLUMN "damagedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_damagedStock_nonnegative" CHECK ("damagedStock" >= 0);
ALTER TABLE "Order"
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancellationStockReleasedAt" TIMESTAMP(3);
ALTER TABLE "StockMovement"
  ADD COLUMN "bucket" "StockBucket" NOT NULL DEFAULT 'SELLABLE',
  ADD COLUMN "returnReceiptId" TEXT;

CREATE TABLE "ReturnReceipt" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "returnRequestId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "receivedQuantity" INTEGER NOT NULL,
  "receivedById" TEXT,
  "sellableQuantity" INTEGER,
  "damagedQuantity" INTEGER,
  "inspectionNote" TEXT,
  "inspectedById" TEXT,
  "inspectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReturnReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReturnReceipt_quantity_positive" CHECK ("receivedQuantity" > 0),
  CONSTRAINT "ReturnReceipt_inspection_split" CHECK (
    ("inspectedAt" IS NULL AND "sellableQuantity" IS NULL AND "damagedQuantity" IS NULL)
    OR ("inspectedAt" IS NOT NULL AND "sellableQuantity" IS NOT NULL AND "damagedQuantity" IS NOT NULL
        AND "sellableQuantity" >= 0 AND "damagedQuantity" >= 0
        AND "sellableQuantity"::BIGINT + "damagedQuantity"::BIGINT = "receivedQuantity")
  )
);
CREATE INDEX "ReturnReceipt_orderId_orderItemId_idx" ON "ReturnReceipt"("orderId", "orderItemId");
CREATE INDEX "ReturnReceipt_returnRequestId_createdAt_idx" ON "ReturnReceipt"("returnRequestId", "createdAt");
ALTER TABLE "ReturnReceipt" ADD CONSTRAINT "ReturnReceipt_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnReceipt" ADD CONSTRAINT "ReturnReceipt_returnRequestId_fkey"
  FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnReceipt" ADD CONSTRAINT "ReturnReceipt_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnReceipt" ADD CONSTRAINT "ReturnReceipt_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReturnReceipt" ADD CONSTRAINT "ReturnReceipt_inspectedById_fkey"
  FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_returnReceiptId_fkey"
  FOREIGN KEY ("returnReceiptId") REFERENCES "ReturnReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "StockMovement_returnReceiptId_bucket_key" ON "StockMovement"("returnReceiptId", "bucket");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receipt_bucket_shape" CHECK (
  ("returnReceiptId" IS NULL AND "bucket" = 'SELLABLE')
  OR ("returnReceiptId" IS NOT NULL AND "type" = 'RETURN' AND "quantity" > 0 AND "reference" IS NOT NULL)
);

CREATE TABLE "OwnDelivery" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "status" "OwnDeliveryStatus" NOT NULL DEFAULT 'ASSIGNED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OwnDelivery_orderId_key" ON "OwnDelivery"("orderId");
ALTER TABLE "OwnDelivery" ADD CONSTRAINT "OwnDelivery_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnDelivery" ADD CONSTRAINT "OwnDelivery_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OwnDeliveryEvent" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "status" "OwnDeliveryStatus" NOT NULL,
  "personId" TEXT,
  "actorId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnDeliveryEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OwnDeliveryEvent_deliveryId_createdAt_idx" ON "OwnDeliveryEvent"("deliveryId", "createdAt");
ALTER TABLE "OwnDeliveryEvent" ADD CONSTRAINT "OwnDeliveryEvent_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "OwnDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnDeliveryEvent" ADD CONSTRAINT "OwnDeliveryEvent_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OwnDeliveryEvent" ADD CONSTRAINT "OwnDeliveryEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CourierOperation" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "sandbox" BOOLEAN NOT NULL,
  "configurationMac" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "evidence" TEXT,
  "outcome" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourierOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourierOperation_kind_check" CHECK ("kind" = 'CANCEL'),
  CONSTRAINT "CourierOperation_status_check" CHECK ("status" IN
    ('AWAITING_RESULT', 'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED', 'RECONCILED'))
);
CREATE UNIQUE INDEX "CourierOperation_shipmentId_kind_key" ON "CourierOperation"("shipmentId", "kind");
CREATE INDEX "CourierOperation_status_createdAt_idx" ON "CourierOperation"("status", "createdAt");
ALTER TABLE "CourierOperation" ADD CONSTRAINT "CourierOperation_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "CourierShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourierOperation" ADD CONSTRAINT "CourierOperation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

## Review before any approved migration

1. Confirm backup/recovery and the identity of a disposable test instance, inventory any legacy returns/stock movements, and review current database constraints without changing data.
2. Generate and inspect a new migration separately; compare it with the Prisma schema and this proposal, including the additional `CHECK` constraints that Prisma schema syntax does not express.
3. Exercise receipt caps, conflicting stock history, cancellation versus dispatch/booking, duplicate submissions, transaction rollback, and provider-failure recovery on the verified disposable instance, without destructive fixtures unless separately authorized.
4. Obtain explicit authorization for any application to the real pre-production database. Treat historical repair and live-provider testing as separate approved work.
