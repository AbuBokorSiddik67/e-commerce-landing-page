# Database

PostgreSQL with Prisma ORM. The application model is in `prisma/schema.prisma`; checked-in SQL migrations are in `prisma/migrations/`. The newest Phase 1 migration has only been tested on synthetic PostgreSQL databases, not an existing installation or through the official Prisma migration CLI. See [deployment readiness](DEPLOYMENT.md) before any real schema change.

## Entity groups

- **Identity:** User, Role, Permission, RolePermission, UserRole, Session, LoginAttempt, PasswordResetToken
- **Configuration:** BusinessSetting, Setting, PaymentMethodConfiguration, CourierProviderConfiguration, DeliveryRule, Integration, Redirect
- **Catalog:** Category, Product, ProductImage, ProductVariant, StockMovement, StockReservation, LandingPage, LandingPageSection, PageVersion, LandingPageTemplate, MediaAsset
- **Commerce:** Customer, CustomerAddress, Order, OrderItem, OrderStatusHistory, Coupon, CouponRedemption, ProductReview, ReturnRequest, ReturnReceipt, Refund
- **Fulfilment:** CourierShipment, CourierTrackingEvent, CourierOperation, OwnDelivery, OwnDeliveryEvent
- **Payments:** PaymentTransaction, PaymentAttempt, WebhookEvent
- **Operations:** Notification, NotificationLog, AnalyticsEvent, DailyAnalyticsSummary, AuditLog

## Key constraints and indexes

- Unique slugs for products and landing pages; unique order numbers, tracking tokens, coupon codes, session token hashes, media keys, webhook event IDs, and provider/reference pairs.
- `LandingPage.productId` is unique: one page per product.
- Foreign keys use a mixture of cascade, set-null and restrictive behavior. In particular, receipt, delivery and courier-operation evidence can prevent deletion of referenced rows; inspect the schema/migration rather than assuming all order children cascade.
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

A zero-count update is converted to a conflict instead of allowing negative stock. Product edits also compare the original stock, variant timestamp and stored attributes atomically; a conflict requires the editor to reload. The inventory adjustment form compares its original stock before setting a new balance. Changing stock through product forms requires inventory-write permission. Product saves never delete existing variants: deactivate them instead to retain order items, movements and reservations.

## Phase 1 cancellation, return and courier evidence

Migration `20261120060000_phase1_order_inventory` adds separate `ProductVariant.damagedStock`, nullable cancellation reason/release timestamp, receipt-linked stock buckets, physical return receipts, own-delivery history and courier-cancellation operations. Existing rows are preserved; the migration does **not** determine whether historical stock was released, classify prior returns or repair inconsistencies. Historical stock movements default to `SELLABLE`, which is not proof of the physical condition of older returns.

New cooperating application writers serialize on the order. A manager may record cancellation without releasing stock when evidence is uncertain; `cancellationStockReleasedAt` applies only to new releases and must not be used to infer historical ones. A physical receipt does not change stock until inspection; the inspected sellable/damaged split and receipt-linked movements are posted together. Local database checks and uniqueness constraints supplement application-level order locks, not cross-row historical review.

Three mixed-version safety assertions still fail: old writers can book and restore stock without honoring the new protocol. The migration alone cannot fence old processes or reconcile an already accepted provider request. Stop/fence and reconcile old writers before a tested cutover, and do not roll back to an unfenced old writer. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Variant attribute storage and upgrade

`ProductVariant.attributes` uses a JSON array of `{ "name": "Size", "value": "M" }` pairs; the empty default is `[]`. Migration `20261120050000_normalize_variant_attributes` converts existing object-shaped variant attributes to arrays, leaves existing arrays intact, and preserves variant IDs and relationships. It changes only the JSON column's default, not its type or relationships. Check the target database's migration history and deployment method before applying pending migrations; take and verify a backup first. In particular, do not blindly apply migration history to a database provisioned with `db push`.

The product editor and duplication can read valid legacy string-to-string objects without writing to the source variant. An empty object becomes an empty array. A top-level object containing either `name` or `value` is ambiguous with a complete or partial single attribute entry and requires operator review, even if it might have been a legitimate legacy map. The existing migration treats every top-level object as a map and cannot resolve that ambiguity, so review affected data before applying it. Invalid types, values outside schema limits, and array entries with unknown fields are rejected instead of being discarded. New variants require an explicit canonical attribute array. On updates, omitted variant attributes are left untouched; an explicit empty array clears them. The migration preserves the JSON type of each legacy value, so non-string values remain invalid and need operator review. Historical `OrderItem.attributes` snapshots are not rewritten. Checkout validates the selected variant's stored attributes before copying their original JSON into a new snapshot; invalid or ambiguous stored data blocks that checkout until reviewed. If the migration is pending, the read adapter does not apply it or change the database default.

Variant attributes are edited as separate name/value rows, not delimiter-separated text. Commas, colons, leading/trailing whitespace and empty values are preserved, and rows can be added or removed without reinterpreting neighboring entries. Textarea display normalizes carriage-return line endings; the editor retains the original line endings for untouched portions when another part of that field is changed. Newline characters entered in the browser use its normalized line-feed representation.

Product edits preserve an existing inactive category and display it as the current assignment; new assignments, including duplicates, must use an active category. The active-category check takes a PostgreSQL row share lock through the product transaction, so category deactivation cannot race between validation and assignment. Category deletion takes an exclusive row lock before checking for products, so a simultaneous assignment cannot be silently cleared after an outdated count. Category changes also carry an original-category precondition. An omitted dimensions field leaves the stored JSON untouched; an explicit JSON `null` clears it, and explicit dimensions must contain only non-negative numeric length, width, and height fields.

## Migrations, bootstrap and retention

For a new, verified empty local development DB, follow [LOCAL_SETUP_BN.md](LOCAL_SETUP_BN.md). `npm run db:check-empty` is a read-only preflight for that embedded helper only. `npm run prisma:deploy` writes the target database, and `npm run db:seed` is a one-time bootstrap that refuses populated application tables. Neither is an upgrade/repair command. Never run them against an existing installation without approved backups, identity verification and a reviewed migration-history/data plan. The official CLI flow remains unverified in this environment.

Audit, analytics, notifications and provider/return evidence grow with usage and may contain sensitive or reconciliation-critical data. Establish a reviewed retention policy, access controls and tested backup/restore; do not blindly delete historical evidence. See [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY.md](SECURITY.md).
