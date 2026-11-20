# Testing

## Commands and verified results

```bash
npm run typecheck   # passed
npm run lint        # passed, no warnings/errors
npm test            # 49 tests passed (12 files)
npm run build       # production build passed
npm run test:e2e    # 4 Playwright tests passed with Chromium
```

Tests use Vitest, React Testing Library, jsdom and a real temporary PostgreSQL database (`landiq_test`), not mocked repositories for core workflows. Run `npx tsx scripts/dev-db.ts` and apply migrations to `landiq_test` before running integration tests.

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

The Playwright suite covers owner login, a customer COD order, invalid tracking, and creating/updating product variants and builder checkboxes through the browser. All four tests passed against a seeded local PostgreSQL database and a production server. The form regression test removes its own uniquely named product afterwards; use a dedicated test database for the suite, since the COD test creates an order.

The official Chromium download endpoint was blocked in this sandbox, so the run used a temporary Chromium 153 headless binary and its libraries obtained from npm. In a normal environment, install the Playwright-managed browser with `npx playwright install chromium`, seed the test database, and run `npm run test:e2e`.

## Not verified

Live SSLCommerz, bKash, Nagad, Pathao, Steadfast and REDX calls require merchant accounts, approved keys and webhook registration. Adapter unit tests mock provider responses; dashboard connection tests call the real APIs when configured. Do not treat mocked results as live certification.
