# Testing

## Commands and verified results

```bash
npm run typecheck   # passed
npm run lint        # passed, no warnings/errors
npm test            # 33 tests passed (7 files)
npm run build       # production build passed
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
| Authentication | Login, session restore, logout revocation, wrong password |
| Components | Accessible alert/empty states via React Testing Library |

## Playwright

`playwright.config.ts` and `tests/e2e/workflows.spec.ts` define browser tests for owner login, a customer COD order and invalid tracking. They were **not executed** in this environment: Chromium download from `cdn.playwright.dev` is blocked and no system browser is installed. Run `npx playwright install chromium && npm run test:e2e` in an environment with browser access.

## Not verified

Live SSLCommerz, bKash, Nagad, Pathao, Steadfast and REDX calls require merchant accounts, approved keys and webhook registration. Adapter unit tests mock provider responses; dashboard connection tests call the real APIs when configured. Do not treat mocked results as live certification.
