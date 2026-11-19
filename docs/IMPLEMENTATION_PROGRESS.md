# Implementation progress

Last updated: 2026-11-19

## Repository baseline

The repository contained only `AI_INSTRUCTIONS.md` and an empty `README.md`; there was no existing framework, dependency set or application code to preserve. A greenfield Next.js implementation was therefore appropriate. `AI_INSTRUCTIONS.md` has not been modified.

## Completed phases (implemented)

| Phase | Status | Evidence |
| --- | --- | --- |
| 0 — Inspection | Complete | Empty repo confirmed; full spec read before changes |
| 1 — Foundation | Complete | Next.js 15, React 19, strict TypeScript, Tailwind, Prisma 6, PostgreSQL, env template |
| 2 — Authentication | Complete | Login/logout, bcrypt, DB sessions, reset flow, login history, seven roles, server-side RBAC, staff UI |
| 3 — Dashboard | Complete | Responsive shell, all requested navigation entries, business settings, redirects |
| 4 — Products | Complete | CRUD, duplicate, archive, categories, variants, flexible attributes, images/specifications |
| 5 — Inventory | Complete | Atomic stock updates, movements, adjustments, low stock, reservations, cancellation/return restock |
| 6 — Landing page engine | Complete | Dynamic `/p/[slug]`, published drafts/scheduling, one reusable renderer |
| 7 — Page builder | Complete | 22 section types, add/edit/duplicate/reorder/enable, theme/SEO controls, three preview widths, drafts, versions, six templates |
| 8 — SEO | Complete | Metadata, OG/Twitter, canonical, JSON-LD, sitemap, robots, noindex, redirects |
| 9 — Orders and COD | Complete | Checkout, order numbers, duplicate protection, filters/export/invoice, separate COD collection/settlement |
| 10 — Payment integrations | Structure complete; live unverified | Independent switches, visibility rules, encrypted credentials, test connection and status, real adapters for SSLCommerz/bKash/Nagad, server-side verification, idempotency |
| 11 — Customer tracking | Complete | Token route, status timeline, masked phone, no street address/internal notes, rate limit |
| 12 — Customers and returns | Complete | Profiles, spending, tags, search, return requests, inspection, restock, refund records |
| 13 — Courier integrations | Structure complete; live unverified | Optional Pathao/Steadfast/REDX adapters, per-provider switches, booking/tracking, manual mode fully functional |
| 14 — Marketing features | Complete | Coupon rules, review moderation, analytics, Meta/GA/GTM controls |
| 15 — Notifications | Complete | In-app, SMTP, SMS gateway, channel switches and delivery logs |
| 16 — Online payment completion | Blocked externally | Awaiting merchant credentials/approval; see below |
| 17 — Security and testing | Complete within environment | 33 passing tests, security headers, validation, audit, encryption; Playwright not executed |
| 18 — Performance and reliability | Partially complete | Indexed queries, SSR dynamic pages, image lazy loading, Next Image-compatible URLs, encrypted backup script; multi-instance caching/limiter not implemented |
| 19 — Deployment and documentation | Complete | Docker Compose, production build, Nginx, env docs, backup/restore guide, all required docs |

## Current phase

Phase 19 documentation and final verification are complete for the implemented scope. No active coding phase is in progress.

## Implemented modules

Authentication/RBAC, dashboard shell, business settings, products, categories, variants, inventory, media library, landing pages/builder/templates, SEO/redirects, checkout/orders/invoices/export, COD accounting, payment provider configuration and adapters, courier provider configuration and adapters, manual courier, tracking, customers, coupons, reviews, returns/refunds, analytics, notifications, marketing integrations, audit logs, Docker/Nginx/backup tooling.

## Verified evidence

- `npm run typecheck`: passed.
- `npm run lint`: passed, no warnings or errors.
- `npm test`: 33/33 tests passed against a real PostgreSQL test database.
- `npm run build`: production build passed.
- HTTP smoke checks: all public pages, `/p/[slug]`, `/track/[token]`, sitemap, robots, health and all 21 dashboard pages returned 200; builder page rendered.
- Real application-level COD order via `/api/orders`: order `LDQ-20261119-A62BF1`, total ৳1,640, stock reduced 25 → 23, no gateway transaction.
- Tracking page: valid token returned 200, phone masked, full address absent.

## Fully implemented and verified

Core COD workflow, manual courier workflow, inventory deduction/restoration, RBAC enforcement in services/actions, product/page CRUD services, publishing/versions, secure tracking field allow-list, payment visibility rules, callback idempotency with mocked provider responses, coupon validation, analytics queries, and all documented UI routes.

## Implemented but not fully verified

- SSLCommerz, bKash and Nagad adapters: real HTTP code paths and server-side verification are implemented, with unit tests using mocked provider responses. No live sandbox/live transaction was executed.
- Pathao, Steadfast and REDX adapters: real HTTP code paths implemented; no live booking or tracking was executed.
- SMTP/SMS notification delivery: adapters implemented; provider acceptance not verified.
- Backup script: written and syntax-reviewed; no restore was performed in this sandbox.

## Partially implemented

- Redis/shared rate limiting: process-local limiter is implemented; multi-instance limiter is not.
- Video section: renders a labelled placeholder; direct embeddable video URL field exists in section data but no iframe renderer was added for safety.
- Daily analytics summary table exists but analytics currently query events/orders directly; the summary is not populated by a scheduled job.

## Not implemented

- SaaS subscriptions, multi-tenancy and workspaces — explicitly excluded by the specification.
- Full refund execution for providers without a documented/refundable API path; internal refund records are clearly labelled as internal.
- Verified courier webhooks (providers were not supplied with registered webhook URLs).

## Awaiting external credentials or approvals

- SSLCommerz store ID/password and approved merchant account.
- bKash app key/secret, username/password and merchant approval.
- Nagad merchant ID and RSA public/private keys with gateway approval.
- Pathao client ID/secret, Steadfast API key/secret, REDX API key.
- SMTP/SMS credentials, Meta CAPI access token, S3 bucket credentials for a specific buyer.
- Playwright Chromium download (`cdn.playwright.dev` blocked) and a system browser for E2E execution.

## Known bugs

None discovered in the executed test suite or HTTP smoke checks. Two issues were found and fixed during verification: an invalid `Intl.DateTimeFormat` option combination on the tracking page, and a public tracking query that initially returned internal order fields (now replaced by an explicit allow-list).

## Failed tests

No currently failing tests. Earlier failures were fixed: actor foreign keys in tests, reused mock Response bodies, React JSX transform in Vitest, and the tracking field allow-list issue.

## Exact next implementation task

Obtain any one merchant sandbox credential set (for example bKash sandbox), configure it in Payment Settings, run the dashboard connection test, place a real test order, verify the provider callback/IPN and refund behaviour, and update this file plus `docs/TESTING.md` with the verified result. Do not mark live integrations complete before that evidence exists.
