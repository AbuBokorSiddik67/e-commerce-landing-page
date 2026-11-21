# LANDIQ implementation baseline

> Historical inspection, including the resumption addendum below. It records what was known at those points, not the current state of the working tree. For the latest fixes, verification, blockers and phase decision, see [Phase 1 — inventory and order integrity](PHASE_1_INVENTORY_ORDER_INTEGRITY.md).

## Inspection scope and worktree

- Branch: `arena/cbfa9b73-e-commerce-landing-page`; inspected HEAD: `f15122247bf9d91aee26e4962b31ac31fd7d35df` (merge of PR #6 into `AI`).
- The inspected worktree, index, and untracked-file list were clean. Although the request described uncommitted work, none was present at inspection. Existing committed work is the baseline and must be preserved.
- This inspection used source and Git metadata only. No database was contacted, no migration or seed was run, and no test was executed. `node_modules` was absent. Only the example environment file was present; no database environment variable name was set in the inspected process environment. This does not establish that any local database is disposable.
- The preceding independent audit returned **FAIL**. Its findings are hypotheses about code paths, not proof of existing production records or of any particular deployed migration state.

## Architecture and business flow

LANDIQ is a Next.js App Router single-business application. Server Actions are in `src/app/actions/`, public APIs in `src/app/api/`, application services in `src/services/`, and PostgreSQL persistence is modeled by `prisma/schema.prisma`. Actions generally call `requirePermission`; the dashboard layout checks only `dashboard.view`. Product, inventory, order, return, payment, settings, audit, and notification logic is split across the files below.

### Checkout through payment and fulfillment

1. `src/components/public/CheckoutForm.tsx` posts to `src/app/api/orders/route.ts`, which invokes `placeOrder` in `src/services/orders.ts`.
2. `placeOrder` validates the enabled payment method, reads product and variant data, validates stored attributes, calculates price and delivery, and checks for a recent duplicate **before** its transaction. The transaction upserts a customer, creates an order, item snapshot, status history and 30-minute reservation, decrements stock through `adjustStock`, creates a sale movement, and records an audit event.
3. Owner/customer notifications occur after the order transaction. COD returns immediately; online checkout calls a provider outside the transaction and subsequently creates a payment transaction/attempt. Initialization failure calls the internal cancellation path. Failures between these steps are not a single atomic operation.
4. `src/app/api/payments/[provider]/{callback,ipn}/route.ts` calls `processPaymentCallback`. It verifies with the provider, looks up a local transaction using either the provider or request reference, conditionally sets `verifiedAt`, then updates the order in a separate transaction. The Nagad verifier currently returns no amount. Provider network calls are outside database transactions, but the local claim and order update can diverge.
5. Staff change order status through `src/app/actions/orders.ts` and `updateOrderStatus`. Manual and provider courier operations are also in `src/services/orders.ts`; financial collection/settlement and return/refund operations are separate. The generic status selector exposes `CANCELLED` and `RETURNED` without routing through stock/return business logic.

### Cancellation, returns, and reservations

- `cancelOrder` and `cancelOrderInternal` in `src/services/orders.ts` read order state outside the transaction; the internal path unconditionally writes `CANCELLED` and then restores item stock for selected prior states. Repeated concurrent reads can both restore stock.
- `src/services/returns.ts` checks for an open return before creating it; neither the check nor the return's restock decision is protected by a transactionally claimed state. A transition away from and back to `RESTOCKED` can repeat a restock. The current return represents an entire order, not individual return quantities.
- `StockReservation` has `orderId`, `variantId`, `quantity`, `expiresAt`, and nullable `releasedAt`; it has no explicit state enum or idempotency/uniqueness constraint. Checkout creates a reservation for COD as well as online payment. No application reservation release or expiry processor was found. The existing stock decrement is a `SALE`, not a separate hold balance.
- `StockMovement` has no database uniqueness key for a business operation. `ReturnRequest` has no unique active-return constraint. App-level serialization can protect cooperating writers, but it cannot establish a database invariant against old application versions or external writers without further schema work.

## Writer inventory and existing transaction boundaries

| Entity/state | Writers and boundaries |
| --- | --- |
| Variant stock | `src/services/inventory.ts` (`adjustStock`, `setStock`); `src/services/products.ts` (nested creation, conditional variant edit, new variant); `prisma/seed.ts` creates demo variants directly. Checkout, cancellation and returns call `adjustStock` inside their transactions. |
| Stock movements | `src/services/inventory.ts` writes movements with adjustments; `src/services/products.ts` separately writes initial, edited, new-variant, and on-publish movements. Draft creation omits an opening movement; publishing can use an earlier stock snapshot. |
| Order status | Initial creation, `cancelOrderInternal`, `updateOrderStatus`, and payment finalization in `src/services/orders.ts`; completion of a return in `src/services/returns.ts`. These paths do not share a single transition protocol. |
| Payment transaction status | Creation, failure marking, and verification claim in `src/services/orders.ts`; the payment transaction and order finalization are not one transaction. Provider implementations are in `src/lib/payments/`. |
| Return status | Creation and updates in `src/services/returns.ts`, reached from `src/app/actions/catalog.ts`. |
| Reservation status | Nested reservation creation in `src/services/orders.ts`; no application release or expiry writer found. |
| Product publication / variant activity | `createProduct`, `updateProduct`, and `setProductStatus` in `src/services/products.ts`; actions in `src/app/actions/products.ts`. Checkout reads eligibility before its stock transaction. |

## Existing protections and compatibility

- `src/lib/product-attributes.ts` reads valid legacy string maps and canonical arrays, rejects ambiguous reserved-key objects, and rejects invalid values or unknown array-entry fields. The unchanged normalization migration converts every object, including ambiguous ones. Historical `OrderItem.attributes` are not modified by that migration. The migration has not been run as part of this inspection.
- Product saves check variant ownership, reject omitted persisted variants, compare stock/timestamp/raw attributes, preserve omitted category and dimensions, and require inventory-write permission for stock changes. Active category assignment takes a PostgreSQL `FOR SHARE` lock and category deletion takes `FOR UPDATE`.
- Negative inventory changes use a conditional `stock >= quantity` update, preventing a negative balance under cooperating checkouts. Inventory set-stock compares only the submitted balance, so an ABA sequence is not detected. Variant timestamps have millisecond precision and raw writers can bypass application-managed timestamps.
- A product update compares the category snapshot but not a product-level version; a stale editor can overwrite a newer publication change. Product specification validation strips unknown entry fields, and absent product attributes/specifications/images default to empty arrays on the current action path.
- `OrderItem` stores product name, one SKU, price, quantity, attributes, and image, but has no separate purchase-time variant-name field. `Order` stores address/district/area but not customer name/email/phone snapshots; invoices read the shared customer. A durable request idempotency key, outbox, explicit stock version, and detailed reservation/return operation identity are absent from the inspected schema. Do not fabricate historical data or modify the schema/migration history in this project.

## Authorization baseline

- `src/lib/auth.ts` provides `requireUser`, `requirePermission`, and `requirePageAccess`; `src/lib/permissions.ts` defines the role matrix.
- `src/app/dashboard/layout.tsx` requires `dashboard.view`, but the inspected dashboard pages have no module-specific `requirePageAccess` calls. For example, product and marketing roles lack `orders.view` but can reach order pages through the shared layout. API export and Server Actions have separate checks that must also be reviewed.
- The configured default roles are Owner, Administrator, Manager, Product Manager, Order Manager, Marketing Manager and Viewer; there is no separately defined Inventory Manager role in the current matrix.

## Test baseline and safety

- `docs/TESTING.md` reports an earlier implementation run of 122 focused unit/component/mocked-service tests and 10 tests against a deliberately partial disposable PostgreSQL fixture. Those results were not rerun during this inspection.
- `tests/integration/order-attribute-compatibility.test.ts` and `tests/integration/product-attributes-compatibility.test.ts` mock Prisma; they are not proof of database locking. `tests/integration/product-disposable-postgres.test.tsx` creates its own cluster and verifies part of its identity before fixture DDL; it models only selected tables and does not exercise full checkout or migrations.
- `tests/helpers.ts:5-11` truncates all public application tables; `tests/integration/landiq-workflows.test.ts`, `form-actions.test.ts`, `pages-products-auth.test.ts`, and `variant-attributes-migration.test.ts` invoke it. The migration test also executes the existing migration SQL. Do not run these suites against any existing or unidentified database; do not execute the migration SQL in this project.
- `tests/setup.ts` defaults to localhost port 55432 if `DATABASE_URL` is absent. Playwright can reuse a server on localhost port 3000 and expects seeded data. Neither target is presumed disposable. Browser tests were not run during this inspection.
- Any new database-backed test must first create an isolated cluster, use unique credentials and port, explicitly verify host, port, data directory, database, schema and user, override application database access, and clean up only its own newly created resources. No migrations, `db push`, destructive reset helper, existing database, or production data may be used.

## Phase dependencies and known constraints

1. **Inventory and order state:** All cancellation, return, expiry, generic status and payment-finalization paths must share a consistent lock/conditional-transition protocol. Payment success versus cancellation/expiry crosses into Phase 2 and must not be declared safe until the shared boundary is addressed and tested. Historical movement inconsistencies require a separate, approved reconciliation; they must not be silently rewritten.
2. **Payments:** Provider verification must occur outside row-lock transactions; finalization and retry recovery must coordinate with Phase 1. Provider response contracts and exact amount/currency representations need evidence; missing verified data must fail closed.
3. **Permissions:** Route-level read guards and current role semantics can be reviewed independently, but the requested phase gate requires completed Phase 1 and 2 before implementation.
4. **Data/reliability:** Product-level stale-write protection and partial-update preservation depend on earlier stock rules. A separate variant-name and customer-identity snapshot, durable request idempotency and outbox may require a separately approved schema migration; no existing historical data can be invented.
5. **Integration/release:** Full-schema and browser evidence requires a demonstrably isolated environment. Existing migration SQL and destructive helpers are prohibited even on that environment under the task's non-negotiable rules; if safe provisioning without them is unavailable, report the limitation instead of claiming coverage.

## Original audit finding map

The preceding audit identified: (1) ambiguous migration conversion, (2) duplicate cancellation/return restoration, (3) payment/order inconsistency, (4) weak payment reference/amount binding, (5) missing dashboard read guards, (6) generic cancellation bypass, (7) opening-ledger inconsistencies, (8) checkout/deactivation races, (9) stale product status writes, (10) incomplete historical snapshots, (11) post-commit/retry problems, (12) absent reservation lifecycle, and (13) lossy product JSON/partial updates. All remain baseline findings pending implementation and independent verification; none is claimed fixed here.

## Addendum — current uncommitted-work baseline before resuming the master remediation

The sections above describe the earlier clean-HEAD inspection; they are retained as historical context and do **not** describe the current working tree. A new read-only inspection of branch `arena/cbfa9b73-e-commerce-landing-page` at HEAD `f15122247bf9d91aee26e4962b31ac31fd7d35df` found no staged changes and the following existing work, all to be preserved:

- Modified tracked files: `package.json`, `package-lock.json`, `src/app/actions/orders.ts`, `src/app/dashboard/orders/[id]/page.tsx`, `src/app/dashboard/orders/page.tsx`, `src/lib/payments/bkash.ts`, `src/lib/payments/nagad.ts`, `src/lib/payments/sslcommerz.ts`, `src/lib/payments/types.ts`, `src/services/inventory.ts`, `src/services/orders.ts`, `src/services/products.ts`, `src/services/returns.ts`, `tests/integration/order-attribute-compatibility.test.ts`, `tests/integration/product-disposable-postgres.test.tsx`, and `tests/unit/payment-providers.test.ts`.
- Untracked files: this baseline, `docs/audits/PHASE_1_INVENTORY_ORDER_INTEGRITY.md`, `src/lib/inventory-invariants.ts`, `src/lib/order-lifecycle.ts`, `src/services/order-lock.ts`, `tests/fixtures/inventory-order-disposable-schema.sql`, and `tests/integration/inventory-order-disposable-postgres.test.ts`. Ignored `node_modules`, `.next`, and temporary test-generation files already exist; their presence does not establish database identity or production readiness.
- No tracked schema or migration differences were observed; the existing normalization migration was read only. No database connection, test, seed, reset, migration or implementation change occurred during this renewed inspection.

The current work already introduces order-row locking, constrained transitions, sale/reservation checks, conservative payment handling, draft opening movements, and identity-verified partial-schema PostgreSQL tests. It is **not a completed Phase 1**. The latest phase report records **FAIL**: a cancellation can restore stock while an in-flight courier provider booking completes, and a manual shipment can be recorded after cancellation. The last prior run reported 39/41 partial-schema inventory tests passing, with two failing courier safety tests; 10 product fixture tests and 122 focused tests passed. Those are prior results, not newly executed evidence in this read-only inspection.

Updated writer inventory: `placeOrder`, `cancelOrderLocked`, `updateOrderStatus`, `processPaymentCallback`, `collectCod` and `settleCod` are in `src/services/orders.ts`; return creation/restocking and refund writers are in `src/services/returns.ts`; courier manual and API booking currently bypass the shared order lock; `src/services/inventory.ts` has `adjustStock` and balance-only `setStock`; product creation/editing also directly writes variant stock and movements in `src/services/products.ts`; `prisma/seed.ts` is a separate seed writer and must not be run. Reservation creation, consumption and conservative expiry are in `src/services/orders.ts`. Publication/deactivation is written by `createProduct`, `updateProduct`, and `setProductStatus`; checkout locks product then variant and rechecks the sale snapshot.

The schema already has `CourierShipment.status` (including `PENDING`) and JSON `payload`, but no durable booking idempotency key, stock-operation key or active-return uniqueness constraint. Any attempt to coordinate provider booking with cancellation must make the local claim durable before a network call, retain ambiguous outcomes for review, and avoid holding database locks across network calls. Actual provider verification/expiry, dashboard page-level authorization, refund concurrency, data snapshots, product partial updates, native-engine/full-schema/browser coverage, and old/noncooperating writers remain unresolved. `tests/setup.ts` defaults to a localhost database and `tests/helpers.ts` truncates tables; neither is a safe default. Playwright may reuse an unknown server. The opt-in isolated fixtures verify the newly created cluster identity before fixture DDL and must remain isolated from all other databases.
