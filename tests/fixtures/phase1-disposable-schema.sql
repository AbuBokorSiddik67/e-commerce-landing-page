-- CREATE-only test fixture for a brand-new, verified disposable cluster.

-- Generated from Prisma metadata; NOT a migration and never for an existing database.

CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED');

CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'ADJUSTMENT', 'SALE', 'CANCELLATION', 'RETURN', 'RESERVATION', 'RELEASE');

CREATE TYPE "StockBucket" AS ENUM ('SELLABLE', 'DAMAGED');

CREATE TYPE "OwnDeliveryStatus" AS ENUM ('ASSIGNED', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'FAILED', 'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED');

CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED_DELIVERY');

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'COD_PENDING', 'COD_COLLECTED');

CREATE TYPE "FinancialStatus" AS ENUM ('UNSETTLED', 'PARTIALLY_SETTLED', 'SETTLED', 'REFUNDED');

CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SETTLED');

CREATE TYPE "CouponType" AS ENUM ('PERCENTAGE', 'FIXED');

CREATE TYPE "CouponRedemptionStatus" AS ENUM ('VALID', 'REDEEMED', 'RELEASED');

CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'INSPECTED', 'RESTOCKED', 'REFUNDED', 'COMPLETED');

CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'FAILED', 'SKIPPED');

CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "mustResetPassword" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");

CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_key_key" ON "Role" ("key");

CREATE TABLE "Permission" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT,
  "group" TEXT,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Permission_key_key" ON "Permission" ("key");

CREATE TABLE "LoginAttempt" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "ip" TEXT,
  "success" BOOLEAN NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt" ("email", "createdAt");

CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt" ("ip", "createdAt");

CREATE TABLE "BusinessSetting" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "description" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "logoUrl" TEXT,
  "faviconUrl" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  "socialLinks" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "deliveryInfo" TEXT,
  "returnPolicy" TEXT,
  "privacyPolicy" TEXT,
  "terms" TEXT,
  "brandColor" TEXT NOT NULL DEFAULT '#206a53',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Setting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "parentId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Category_slug_key" ON "Category" ("slug");

CREATE INDEX "Category_parentId_sortOrder_idx" ON "Category" ("parentId", "sortOrder");

CREATE TABLE "LandingPageTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "sections" JSONB NOT NULL,
  "theme" JSONB NOT NULL,
  "previewColor" TEXT NOT NULL DEFAULT '#206a53',
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LandingPageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LandingPageTemplate_code_key" ON "LandingPageTemplate" ("code");

CREATE TABLE "Redirect" (
  "id" TEXT NOT NULL,
  "fromPath" TEXT NOT NULL,
  "toPath" TEXT NOT NULL,
  "permanent" BOOLEAN NOT NULL DEFAULT TRUE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Redirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Redirect_fromPath_key" ON "Redirect" ("fromPath");

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "alt" TEXT,
  "folder" TEXT NOT NULL DEFAULT 'General',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_key_key" ON "MediaAsset" ("key");

CREATE INDEX "MediaAsset_folder_idx" ON "MediaAsset" ("folder");

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "notes" TEXT,
  "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer" ("phone");

CREATE INDEX "Customer_name_idx" ON "Customer" ("name");

CREATE TABLE "PaymentMethodConfiguration" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "visible" BOOLEAN NOT NULL DEFAULT FALSE,
  "sandbox" BOOLEAN NOT NULL DEFAULT TRUE,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "credentials" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'unconfigured',
  "lastTestedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentMethodConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentMethodConfiguration_code_key" ON "PaymentMethodConfiguration" ("code");

CREATE TABLE "CourierProviderConfiguration" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "visible" BOOLEAN NOT NULL DEFAULT FALSE,
  "sandbox" BOOLEAN NOT NULL DEFAULT TRUE,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "credentials" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "settings" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'unconfigured',
  "lastTestedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourierProviderConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourierProviderConfiguration_code_key" ON "CourierProviderConfiguration" ("code");

CREATE TABLE "DeliveryRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'district',
  "matchValue" TEXT NOT NULL,
  "charge" INTEGER NOT NULL,
  "freeAbove" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyAnalyticsSummary" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "pageViews" INTEGER NOT NULL DEFAULT 0,
  "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
  "ctaClicks" INTEGER NOT NULL DEFAULT 0,
  "orders" INTEGER NOT NULL DEFAULT 0,
  "revenue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyAnalyticsSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyAnalyticsSummary_date_key" ON "DailyAnalyticsSummary" ("date");

CREATE TABLE "Integration" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'disabled',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Integration_code_key" ON "Integration" ("code");

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "processedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent" ("provider", "eventId");

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId"),
  CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "UserRole" (
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId"),
  CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session" ("tokenHash");

CREATE INDEX "Session_userId_expiresAt_idx" ON "Session" ("userId", "expiresAt");

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken" ("tokenHash");

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "sku" TEXT,
  "shortDescription" TEXT,
  "description" TEXT,
  "regularPrice" INTEGER NOT NULL,
  "salePrice" INTEGER,
  "categoryId" TEXT,
  "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "isFeatured" BOOLEAN NOT NULL DEFAULT FALSE,
  "videoUrl" TEXT,
  "weightGrams" INTEGER,
  "dimensions" JSONB,
  "attributes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "specifications" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "publishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Product_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Product_slug_key" ON "Product" ("slug");

CREATE INDEX "Product_status_createdAt_idx" ON "Product" ("status", "createdAt");

CREATE INDEX "Product_categoryId_idx" ON "Product" ("categoryId");

CREATE TABLE "CustomerAddress" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Home',
  "address" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "area" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "before" JSONB,
  "after" JSONB,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog" ("entity", "entityId");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");

CREATE TABLE "ProductImage" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "alt" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'IMAGE',
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProductImage_productId_position_idx" ON "ProductImage" ("productId", "position");

CREATE TABLE "ProductVariant" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "price" INTEGER,
  "compareAtPrice" INTEGER,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "damagedStock" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
  "imageUrl" TEXT,
  "attributes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductVariant_damagedStock_nonnegative" CHECK ("damagedStock" >= 0)
);

CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant" ("sku");

CREATE INDEX "ProductVariant_productId_position_idx" ON "ProductVariant" ("productId", "position");

CREATE TABLE "LandingPage" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
  "templateCode" TEXT NOT NULL DEFAULT 'general',
  "theme" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "seo" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "analytics" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "settings" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "noIndex" BOOLEAN NOT NULL DEFAULT FALSE,
  "publishedAt" TIMESTAMP(3),
  "scheduledFor" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LandingPage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LandingPage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LandingPage_productId_key" ON "LandingPage" ("productId");

CREATE UNIQUE INDEX "LandingPage_slug_key" ON "LandingPage" ("slug");

CREATE INDEX "LandingPage_status_publishedAt_idx" ON "LandingPage" ("status", "publishedAt");

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "quantity" INTEGER NOT NULL,
  "subtotal" INTEGER NOT NULL,
  "deliveryCharge" INTEGER NOT NULL DEFAULT 0,
  "courierFee" INTEGER NOT NULL DEFAULT 0,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "paymentMethod" TEXT NOT NULL DEFAULT 'cod',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentReference" TEXT,
  "financialStatus" "FinancialStatus" NOT NULL DEFAULT 'UNSETTLED',
  "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryOption" TEXT NOT NULL DEFAULT 'inside_city',
  "deliveryChargeRuleId" TEXT,
  "address" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "area" TEXT,
  "customerNote" TEXT,
  "internalNote" TEXT,
  "couponCode" TEXT,
  "trackingToken" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "source" TEXT NOT NULL DEFAULT 'landing_page',
  "confirmedAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "cancellationStockReleasedAt" TIMESTAMP(3),
  "expectedDeliveryAt" TIMESTAMP(3),
  "codCollectedAt" TIMESTAMP(3),
  "codSettledAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order" ("orderNumber");

CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order" ("trackingToken");

CREATE INDEX "Order_status_createdAt_idx" ON "Order" ("status", "createdAt");

CREATE INDEX "Order_customerId_createdAt_idx" ON "Order" ("customerId", "createdAt");

CREATE INDEX "Order_productId_createdAt_idx" ON "Order" ("productId", "createdAt");

CREATE INDEX "Order_paymentMethod_createdAt_idx" ON "Order" ("paymentMethod", "createdAt");

CREATE TABLE "Coupon" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" "CouponType" NOT NULL,
  "value" INTEGER NOT NULL,
  "productId" TEXT,
  "minOrderValue" INTEGER NOT NULL DEFAULT 0,
  "maxDiscount" INTEGER,
  "usageLimit" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "firstOrderOnly" BOOLEAN NOT NULL DEFAULT FALSE,
  "expiresAt" TIMESTAMP(3),
  "startsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Coupon_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon" ("code");

CREATE INDEX "Coupon_code_isActive_idx" ON "Coupon" ("code", "isActive");

CREATE TABLE "StockReservation" (
  "id" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StockReservation_expiresAt_idx" ON "StockReservation" ("expiresAt");

CREATE TABLE "LandingPageSection" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "LandingPageSection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LandingPageSection_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "LandingPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LandingPageSection_pageId_position_idx" ON "LandingPageSection" ("pageId", "position");

CREATE TABLE "PageVersion" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "LandingPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PageVersion_pageId_version_key" ON "PageVersion" ("pageId", "version");

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "variantId" TEXT,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "unitPrice" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "imageUrl" TEXT,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "OrderStatusHistory" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "fromStatus" "OrderStatus",
  "toStatus" "OrderStatus" NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderStatusHistory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory" ("orderId", "createdAt");

CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "reference" TEXT,
  "status" TEXT NOT NULL DEFAULT 'INITIATED',
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "sandbox" BOOLEAN NOT NULL DEFAULT TRUE,
  "checkoutUrl" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PaymentTransaction_provider_reference_key" ON "PaymentTransaction" ("provider", "reference");

CREATE INDEX "PaymentTransaction_orderId_createdAt_idx" ON "PaymentTransaction" ("orderId", "createdAt");

CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "response" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PaymentAttempt_orderId_createdAt_idx" ON "PaymentAttempt" ("orderId", "createdAt");

CREATE TABLE "CourierShipment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "consignmentId" TEXT,
  "trackingId" TEXT,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
  "cost" INTEGER NOT NULL DEFAULT 0,
  "codAmount" INTEGER NOT NULL DEFAULT 0,
  "trackingUrl" TEXT,
  "labelUrl" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourierShipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourierShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourierShipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CourierShipment_orderId_idx" ON "CourierShipment" ("orderId");

CREATE INDEX "CourierShipment_trackingId_idx" ON "CourierShipment" ("trackingId");

CREATE TABLE "OwnDelivery" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "status" "OwnDeliveryStatus" NOT NULL DEFAULT 'ASSIGNED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnDelivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnDelivery_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OwnDelivery_orderId_key" ON "OwnDelivery" ("orderId");

CREATE TABLE "CouponRedemption" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "customerId" TEXT,
  "orderId" TEXT NOT NULL,
  "status" "CouponRedemptionStatus" NOT NULL DEFAULT 'VALID',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CouponRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CouponRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CouponRedemption_couponId_orderId_key" ON "CouponRedemption" ("couponId", "orderId");

CREATE TABLE "ReturnRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
  "restock" BOOLEAN NOT NULL DEFAULT TRUE,
  "inspectionNote" TEXT,
  "refundAmount" INTEGER NOT NULL DEFAULT 0,
  "returnCharge" INTEGER NOT NULL DEFAULT 0,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReturnRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest" ("status", "createdAt");

CREATE TABLE "ProductReview" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "customerId" TEXT,
  "orderId" TEXT,
  "customerName" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "title" TEXT,
  "body" TEXT NOT NULL,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "verifiedPurchase" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ProductReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ProductReview_productId_status_idx" ON "ProductReview" ("productId", "status");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "customerId" TEXT,
  "orderId" TEXT,
  "type" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "readAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Notification_userId_readAt_idx" ON "Notification" ("userId", "readAt");

CREATE INDEX "Notification_createdAt_idx" ON "Notification" ("createdAt");

CREATE TABLE "AnalyticsEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "pageId" TEXT,
  "productId" TEXT,
  "orderId" TEXT,
  "visitorId" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "LandingPage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AnalyticsEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AnalyticsEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent" ("type", "createdAt");

CREATE INDEX "AnalyticsEvent_pageId_visitorId_createdAt_idx" ON "AnalyticsEvent" ("pageId", "visitorId", "createdAt");

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "transactionId" TEXT,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECORDED',
  "providerReference" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'INTERNAL',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Refund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Refund_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CourierTrackingEvent" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "status" "ShipmentStatus" NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "eventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "raw" JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "CourierTrackingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourierTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "CourierShipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
  CONSTRAINT "CourierOperation_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "CourierShipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CourierOperation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CourierOperation_kind_check" CHECK ("kind" = 'CANCEL'),
  CONSTRAINT "CourierOperation_status_check" CHECK ("status" IN ('AWAITING_RESULT', 'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED', 'RECONCILED'))
);

CREATE UNIQUE INDEX "CourierOperation_shipmentId_kind_key" ON "CourierOperation" ("shipmentId", "kind");

CREATE INDEX "CourierOperation_status_createdAt_idx" ON "CourierOperation" ("status", "createdAt");

CREATE TABLE "OwnDeliveryEvent" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "status" "OwnDeliveryStatus" NOT NULL,
  "personId" TEXT,
  "actorId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnDeliveryEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnDeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "OwnDelivery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnDeliveryEvent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "OwnDeliveryEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "OwnDeliveryEvent_deliveryId_createdAt_idx" ON "OwnDeliveryEvent" ("deliveryId", "createdAt");

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
  CONSTRAINT "ReturnReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReturnReceipt_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReturnReceipt_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReturnReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ReturnReceipt_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ReturnReceipt_quantity_positive" CHECK ("receivedQuantity" > 0),
  CONSTRAINT "ReturnReceipt_inspection_split" CHECK (("inspectedAt" IS NULL AND "sellableQuantity" IS NULL AND "damagedQuantity" IS NULL) OR ("inspectedAt" IS NOT NULL AND "sellableQuantity" IS NOT NULL AND "damagedQuantity" IS NOT NULL AND "sellableQuantity" >= 0 AND "damagedQuantity" >= 0 AND "sellableQuantity"::BIGINT + "damagedQuantity"::BIGINT = "receivedQuantity"))
);

CREATE INDEX "ReturnReceipt_orderId_orderItemId_idx" ON "ReturnReceipt" ("orderId", "orderItemId");

CREATE INDEX "ReturnReceipt_returnRequestId_createdAt_idx" ON "ReturnReceipt" ("returnRequestId", "createdAt");

CREATE TABLE "NotificationLog" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "response" TEXT,
  "error" TEXT,
  "status" "NotificationStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "type" "StockMovementType" NOT NULL,
  "bucket" "StockBucket" NOT NULL DEFAULT 'SELLABLE',
  "quantity" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" TEXT,
  "reference" TEXT,
  "returnReceiptId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StockMovement_returnReceiptId_fkey" FOREIGN KEY ("returnReceiptId") REFERENCES "ReturnReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StockMovement_receipt_bucket_shape" CHECK (("returnReceiptId" IS NULL AND "bucket" = 'SELLABLE') OR ("returnReceiptId" IS NOT NULL AND "type" = 'RETURN' AND "quantity" > 0 AND "reference" IS NOT NULL))
);

CREATE UNIQUE INDEX "StockMovement_returnReceiptId_bucket_key" ON "StockMovement" ("returnReceiptId", "bucket");

CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement" ("productId", "createdAt");

CREATE INDEX "StockMovement_variantId_createdAt_idx" ON "StockMovement" ("variantId", "createdAt");
