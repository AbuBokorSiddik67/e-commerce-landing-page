# Database

PostgreSQL with Prisma ORM. The authoritative schema is `prisma/schema.prisma`; the initial migration is in `prisma/migrations/`.

## Entity groups

- **Identity:** User, Role, Permission, RolePermission, UserRole, Session, LoginAttempt, PasswordResetToken
- **Configuration:** BusinessSetting, Setting, PaymentMethodConfiguration, CourierProviderConfiguration, DeliveryRule, Integration, Redirect
- **Catalog:** Category, Product, ProductImage, ProductVariant, StockMovement, StockReservation, LandingPage, LandingPageSection, PageVersion, LandingPageTemplate, MediaAsset
- **Commerce:** Customer, CustomerAddress, Order, OrderItem, OrderStatusHistory, Coupon, CouponRedemption, ProductReview, ReturnRequest, Refund
- **Fulfilment:** CourierShipment, CourierTrackingEvent
- **Payments:** PaymentTransaction, PaymentAttempt, WebhookEvent
- **Operations:** Notification, NotificationLog, AnalyticsEvent, DailyAnalyticsSummary, AuditLog

## Key constraints and indexes

- Unique slugs for products and landing pages; unique order numbers, tracking tokens, coupon codes, session token hashes, media keys, webhook event IDs, and provider/reference pairs.
- `LandingPage.productId` is unique: one page per product.
- Foreign keys cascade for owned children (sections, order items, status history, shipments) and set null for optional audit actors.
- Indexes cover common filters: order status/date, customer, product, payment method, landing page status, stock movements, analytics event type/date, audit entity/time.

## Money and status fields

All amounts are integers in BDT. Orders keep separate fields:

- `status` — delivery/business state (Pending → Delivered, Cancelled, Returned…)
- `paymentStatus` — payment lifecycle (including `COD_PENDING`, `COD_COLLECTED`)
- `financialStatus` — revenue state (unsettled, partially settled, settled, refunded)
- `settlementStatus` — COD/payout settlement state

An order being `DELIVERED` does not change financial state automatically.

## Transactions

Order placement, cancellation, return restocking, stock adjustment, page saves and provider verification claim all use `prisma.$transaction`. Overselling protection uses a conditional atomic update:

```ts
updateMany({ where: { id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } })
```

A zero-count update is converted to a conflict instead of allowing negative stock.

## Variant attribute storage and upgrade

`ProductVariant.attributes` uses a JSON array of `{ "name": "Size", "value": "M" }` pairs; the empty default is `[]`. Before deploying the updated product editor, back up the database and run `npm run prisma:deploy`. Migration `20261120050000_normalize_variant_attributes` converts existing object-shaped variant attributes to arrays, leaves existing arrays intact, and preserves variant IDs and relationships. It changes only the JSON column's default, not its type or relationships.

The migration preserves the JSON type of each legacy value instead of silently changing or discarding it. Non-string values remain invalid under the existing Zod schema and need operator review. Historical `OrderItem.attributes` snapshots are not rewritten.

## Migrations and data retention

```bash
npm run prisma:deploy                      # production
npm run prisma:migrate -- --name change    # create a development migration
```

Audit logs, analytics events and notification logs grow with usage. Use the backup script plus a retention job for these tables if required by the operator; the schema does not delete business records automatically. Encrypted backups and restore instructions are in [DEPLOYMENT.md](DEPLOYMENT.md).
