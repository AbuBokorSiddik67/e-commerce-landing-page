# Testing

## Commands and verified results

For the product-preservation changes, the focused unit/component/mocked-service run passed 122 tests, the opt-in disposable PostgreSQL fixture passed 10 tests, and typecheck, lint and production build passed. The full database-backed integration and Playwright suites were not rerun for this change.

Some integration suites use `tests/helpers.ts`, whose reset helper truncates public tables. Never point them at an existing or unidentified database, and do not run them when a database reset is not expressly permitted.

### Product preservation checks

The focused unit, component and mocked-service checks can be run without a database:

```bash
npx vitest run tests/unit tests/components tests/integration/product-attributes-compatibility.test.ts tests/integration/order-attribute-compatibility.test.ts
```

A separate opt-in suite creates a fresh embedded PostgreSQL cluster in a unique `tmp/phase11-postgres-*` directory, checks its directory, port and user before creating a partial test-only schema, and removes only that newly created cluster on exit:

```bash
LANDIQ_DISPOSABLE_PG_TEST=1 npx vitest run tests/integration/product-disposable-postgres.test.tsx
```

This suite ignores `DATABASE_URL`, does not run migrations or `db push`, and never invokes the reset helper. It tests actual PostgreSQL transactions and selected foreign keys, but its partial fixture is not the full deployed schema and is not a replacement for migration or full application end-to-end testing. It requires a working Prisma query engine and embedded PostgreSQL support on the host.

## Covered workflows

| Area | Coverage |
| --- | --- |
| Pricing and coupons | Variant/sale price precedence, capped discounts, expiry, limits, first-order and product scope |
| Permissions | Owner, specialised roles, combined roles, forbidden settings access |
| Sections | All 22 section types, six templates, strict schema rejects arbitrary keys/scripts |
| Payment adapters | Missing credentials, SSLCommerz init/validation, bKash query verification, registry |
| Scenario A | COD-only checkout: no gateway call, order created, stock reduced, no payment transaction |
| Scenario B | COD + bKash visibility; disabled providers rejected by backend; missing credentials hidden and flagged |
| Scenario C | COD disabled is rejected and not offered |
| Scenario D | Manual courier assignment, manual tracking events, status history, no API required |
| Scenario E | Disabled/misconfigured courier booking rejected |
| Scenario F | Provider failure cancels order, restores stock, never marks it paid |
| Payment callbacks | Server-side validation, amount check, duplicate callback idempotency, disabled provider rejection |
| Inventory | Concurrent last-unit orders (one succeeds), cancellation restocks |
| Products/pages | Create/update/duplicate, variant stock, template application, drafts/versions/publish, slug and section validation |
| Form validation | Product and builder FormData, multiple variant attributes, existing IDs and relationships, checked/unchecked booleans, invalid payloads, and PostgreSQL migration of legacy variant JSON |
| Authentication | Login, session restore, logout revocation, wrong password |
| Components | Accessible alert/empty states via React Testing Library |

## Playwright

The Playwright suite covers owner login, a customer COD order, invalid tracking, and creating/updating product variants and builder checkboxes through the browser. All four tests passed in an earlier run against a seeded local PostgreSQL database and a production server; the updated form test was not rerun for these product-preservation changes. The form regression test removes its own uniquely named product afterwards; use a dedicated test database for the suite, since the COD test creates an order.

The official Chromium download endpoint was blocked in this sandbox, so the run used a temporary Chromium 153 headless binary and its libraries obtained from npm. In a normal environment, install the Playwright-managed browser with `npx playwright install chromium`, seed the test database, and run `npm run test:e2e`.

## Not verified

Live SSLCommerz, bKash, Nagad, Pathao, Steadfast and REDX calls require merchant accounts, approved keys and webhook registration. Adapter unit tests mock provider responses; dashboard connection tests call the real APIs when configured. Do not treat mocked results as live certification.
