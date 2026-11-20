-- Test-only, deliberately partial PostgreSQL fixture. This is NOT a migration.
-- It models the columns and foreign keys used by product/variant services;
-- User and Order are minimal stubs. Never apply it to an existing database.
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'ADJUSTMENT', 'SALE', 'CANCELLATION', 'RETURN', 'RESERVATION', 'RELEASE');

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY
);

CREATE TABLE "Category" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "imageUrl" TEXT,
  "parentId" TEXT REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Product" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "sku" TEXT,
  "shortDescription" TEXT,
  "description" TEXT,
  "regularPrice" INTEGER NOT NULL,
  "salePrice" INTEGER,
  "categoryId" TEXT REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  "videoUrl" TEXT,
  "weightGrams" INTEGER,
  "dimensions" JSONB,
  "attributes" JSONB NOT NULL DEFAULT '[]',
  "specifications" JSONB NOT NULL DEFAULT '[]',
  "publishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ProductImage" (
  "id" TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "url" TEXT NOT NULL,
  "alt" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'IMAGE',
  "position" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "ProductVariant" (
  "id" TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "sku" TEXT UNIQUE,
  "price" INTEGER,
  "compareAtPrice" INTEGER,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
  "imageUrl" TEXT,
  "attributes" JSONB NOT NULL DEFAULT '[]',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "StockMovement" (
  "id" TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "variantId" TEXT REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "type" "StockMovementType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" TEXT,
  "reference" TEXT,
  "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Order" (
  "id" TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OrderItem" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "variantId" TEXT REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "unitPrice" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "imageUrl" TEXT
);

CREATE TABLE "StockReservation" (
  "id" TEXT PRIMARY KEY,
  "variantId" TEXT NOT NULL REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "quantity" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
