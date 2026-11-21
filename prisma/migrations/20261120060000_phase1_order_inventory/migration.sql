-- Additive Phase 1 schema. Existing historical rows are preserved; this
-- migration does not infer return receipts or repair historical stock.
-- Apply only after backup and migration-history/data review.
BEGIN;

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

COMMIT;
