-- Test-only, hand-written PARTIAL schema. Not a migration and never for an
-- existing database. The fixture covers the columns used by Phase 1 services;
-- it deliberately does not claim to reproduce the entire application schema.
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED');
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'ADJUSTMENT', 'SALE', 'CANCELLATION', 'RETURN', 'RESERVATION', 'RELEASE');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED_DELIVERY');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'COD_PENDING', 'COD_COLLECTED');
CREATE TYPE "FinancialStatus" AS ENUM ('UNSETTLED', 'PARTIALLY_SETTLED', 'SETTLED', 'REFUNDED');
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SETTLED');
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'INSPECTED', 'RESTOCKED', 'REFUNDED', 'COMPLETED');
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED');

CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
CREATE TABLE "Category" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT, "imageUrl" TEXT, "parentId" TEXT REFERENCES "Category"("id") ON DELETE SET NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Product" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL UNIQUE, "sku" TEXT,
  "shortDescription" TEXT, "description" TEXT, "regularPrice" INTEGER NOT NULL, "salePrice" INTEGER,
  "categoryId" TEXT REFERENCES "Category"("id") ON DELETE SET NULL,
  "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT', "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  "videoUrl" TEXT, "weightGrams" INTEGER, "dimensions" JSONB,
  "attributes" JSONB NOT NULL DEFAULT '[]', "specifications" JSONB NOT NULL DEFAULT '[]',
  "publishedAt" TIMESTAMP(3), "archivedAt" TIMESTAMP(3), "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ProductImage" (
  "id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "url" TEXT NOT NULL, "alt" TEXT, "kind" TEXT NOT NULL DEFAULT 'IMAGE', "position" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "ProductVariant" (
  "id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL, "sku" TEXT UNIQUE, "price" INTEGER, "compareAtPrice" INTEGER,
  "stock" INTEGER NOT NULL DEFAULT 0, "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
  "imageUrl" TEXT, "attributes" JSONB NOT NULL DEFAULT '[]', "isActive" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "StockMovement" (
  "id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "variantId" TEXT REFERENCES "ProductVariant"("id") ON DELETE SET NULL, "type" "StockMovementType" NOT NULL,
  "quantity" INTEGER NOT NULL, "balanceAfter" INTEGER NOT NULL, "reason" TEXT, "reference" TEXT,
  "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "LandingPage" (
  "id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL UNIQUE REFERENCES "Product"("id") ON DELETE CASCADE,
  "slug" TEXT NOT NULL UNIQUE, "title" TEXT NOT NULL, "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
  "templateCode" TEXT NOT NULL DEFAULT 'general', "theme" JSONB NOT NULL DEFAULT '{}', "seo" JSONB NOT NULL DEFAULT '{}',
  "analytics" JSONB NOT NULL DEFAULT '{}', "settings" JSONB NOT NULL DEFAULT '{}', "noIndex" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3), "scheduledFor" TIMESTAMP(3), "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Customer" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "phone" TEXT NOT NULL UNIQUE, "email" TEXT,
  "notes" TEXT, "tags" JSONB NOT NULL DEFAULT '[]', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "CustomerAddress" (
  "id" TEXT PRIMARY KEY, "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "label" TEXT NOT NULL DEFAULT 'Home', "address" TEXT NOT NULL, "district" TEXT NOT NULL, "area" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Order" (
  "id" TEXT PRIMARY KEY, "orderNumber" TEXT NOT NULL UNIQUE,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id"), "productId" TEXT NOT NULL REFERENCES "Product"("id"), "variantId" TEXT,
  "quantity" INTEGER NOT NULL, "subtotal" INTEGER NOT NULL, "deliveryCharge" INTEGER NOT NULL DEFAULT 0,
  "courierFee" INTEGER NOT NULL DEFAULT 0, "discount" INTEGER NOT NULL DEFAULT 0, "total" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT', "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "paymentMethod" TEXT NOT NULL DEFAULT 'cod', "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentReference" TEXT, "financialStatus" "FinancialStatus" NOT NULL DEFAULT 'UNSETTLED',
  "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PENDING', "deliveryOption" TEXT NOT NULL DEFAULT 'inside_city',
  "deliveryChargeRuleId" TEXT, "address" TEXT NOT NULL, "district" TEXT NOT NULL, "area" TEXT,
  "customerNote" TEXT, "internalNote" TEXT, "couponCode" TEXT, "trackingToken" TEXT NOT NULL UNIQUE,
  "ip" TEXT, "userAgent" TEXT, "source" TEXT NOT NULL DEFAULT 'landing_page',
  "confirmedAt" TIMESTAMP(3), "shippedAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
  "expectedDeliveryAt" TIMESTAMP(3), "codCollectedAt" TIMESTAMP(3), "codSettledAt" TIMESTAMP(3),
  "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "OrderItem" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "variantId" TEXT REFERENCES "ProductVariant"("id") ON DELETE SET NULL, "name" TEXT NOT NULL, "sku" TEXT,
  "unitPrice" INTEGER NOT NULL, "quantity" INTEGER NOT NULL, "lineTotal" INTEGER NOT NULL,
  "attributes" JSONB NOT NULL DEFAULT '{}', "imageUrl" TEXT
);
CREATE TABLE "OrderStatusHistory" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "fromStatus" "OrderStatus", "toStatus" "OrderStatus" NOT NULL, "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "note" TEXT, "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "StockReservation" (
  "id" TEXT PRIMARY KEY, "variantId" TEXT NOT NULL REFERENCES "ProductVariant"("id") ON DELETE CASCADE,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE, "quantity" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "releasedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PaymentTransaction" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL, "reference" TEXT, "status" TEXT NOT NULL DEFAULT 'INITIATED', "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT', "sandbox" BOOLEAN NOT NULL DEFAULT true, "checkoutUrl" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}', "verifiedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, UNIQUE ("provider", "reference")
);
CREATE TABLE "PaymentAttempt" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL, "status" TEXT NOT NULL, "response" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Refund" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "transactionId" TEXT REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL, "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RECORDED', "providerReference" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'INTERNAL', "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ReturnRequest" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id"), "reason" TEXT NOT NULL, "details" TEXT,
  "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED', "restock" BOOLEAN NOT NULL DEFAULT true,
  "inspectionNote" TEXT, "refundAmount" INTEGER NOT NULL DEFAULT 0, "returnCharge" INTEGER NOT NULL DEFAULT 0,
  "resolvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PaymentMethodConfiguration" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "visible" BOOLEAN NOT NULL DEFAULT false, "sandbox" BOOLEAN NOT NULL DEFAULT true, "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "credentials" JSONB NOT NULL DEFAULT '{}', "status" TEXT NOT NULL DEFAULT 'unconfigured', "lastTestedAt" TIMESTAMP(3),
  "lastError" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "WebhookEvent" (
  "id" TEXT PRIMARY KEY, "provider" TEXT NOT NULL, "eventId" TEXT NOT NULL, "payload" JSONB NOT NULL DEFAULT '{}',
  "processedAt" TIMESTAMP(3), "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("provider", "eventId")
);
CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY, "actorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL, "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL, "entityId" TEXT, "before" JSONB, "after" JSONB, "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CourierProviderConfiguration" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "visible" BOOLEAN NOT NULL DEFAULT false,
  "sandbox" BOOLEAN NOT NULL DEFAULT true, "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "credentials" JSONB NOT NULL DEFAULT '{}', "settings" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'unconfigured', "lastTestedAt" TIMESTAMP(3),
  "lastError" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "CourierShipment" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "providerCode" TEXT NOT NULL, "consignmentId" TEXT, "trackingId" TEXT,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING', "cost" INTEGER NOT NULL DEFAULT 0,
  "codAmount" INTEGER NOT NULL DEFAULT 0, "trackingUrl" TEXT, "labelUrl" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}', "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "CourierTrackingEvent" (
  "id" TEXT PRIMARY KEY, "shipmentId" TEXT NOT NULL REFERENCES "CourierShipment"("id") ON DELETE CASCADE,
  "status" "ShipmentStatus" NOT NULL, "description" TEXT, "location" TEXT,
  "eventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "raw" JSONB NOT NULL DEFAULT '{}'
);
