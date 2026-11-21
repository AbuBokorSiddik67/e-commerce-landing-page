# Implementation progress and current review

Last updated: 2026-11-19

## Decision

**MVP functionality is implemented in important areas, but this tree is not production-ready.** Three mixed-version courier/stock safety assertions fail, and deployment, existing data, official Prisma CLI/runtime, backup/restore and real integrations remain unverified. See [DEPLOYMENT.md](DEPLOYMENT.md) for the required gates. No real installation, provider or backup was modified during this review.

## Current capabilities and limits

| Area | Current state |
| --- | --- |
| Catalog / pages | Product variants, inventory ledger, publishing and landing-page builder are implemented. Product-preservation tests include an isolated PostgreSQL fixture. |
| Storefront / checkout | `/shop`, browser-local cart and COD checkout are implemented. Each cart line creates a separate order. Keyed retries are conditional on retaining the same random checkout key and details; legacy unkeyed API clients have weaker duplicate protection. |
| Orders / stock | Cooperating writers use order locks. A manager cancellation may be recorded while retaining stock when payment, fulfillment, courier or ledger evidence is ambiguous. Safe undispatched cancellations release stock once; a paid/collected order can still require a separate refund. Current tests do not make old writers safe. |
| Returns / delivery | Shop-delivery and courier reports are not warehouse receipts. Staff record physical receipt and inspect sellable/damaged quantities before stock credit; physical inspection and unresolved financial refunds are separate. Manual courier and selected recovery flows have synthetic/browser coverage. |
| Identity / access | Owner protection, server-side role validation, mandatory change of temporary staff passwords, reset/session revocation and selected API access controls are implemented. Tests cover selected roles/routes, not a complete security audit. |
| Payments / couriers | SSLCommerz, bKash, Nagad, Pathao, Steadfast and REDX adapters exist but were not tested against merchant sandboxes or live services. SSLCommerz connection status is not falsely treated as verified; Nagad currently lacks the verified amount/currency required by paid confirmation. Uncertain calls/claims require staff reconciliation; they are not automatically retried. |
| Finance | COD collection/settlement and internal refund records exist. Internal records or provider-reported refund responses are not proof of actual payout. |
| Notifications / storage | Email, SMS, local uploads and S3 interfaces exist; provider deliveries/S3 remain unverified. Local uploads now persist outside the build's `public` directory, with a legacy-path fallback. |
| Runtime / operations | Additive Phase 1 migration, explicit empty-DB bootstrap, Compose/Nginx and backup tooling are present. SQL was tested on synthetic DBs only; official Prisma CLI, Docker/TLS and real backup/restore have not been exercised. |

Other known functional limits include process-local rate limiting, no automatic reservation-expiry scheduler, no verified courier webhooks, a video placeholder, no populated daily analytics summary job, and no public sticky CTA despite the builder setting. External service availability is not established by mocked tests.

## Evidence from this review

- Selected `npm test`: **269/269 passed across 44 files**; typecheck, lint and `git diff --check` passed. These are unit, component and mocked-service/access checks, not all tests.
- Identity-verified disposable PostgreSQL: migration/auth **10/10**, product **15/15**, closure **27/27**. Inventory/order **172/175** with the three unskipped old/new-writer safety failures. Fixture providers were mocked; clusters were cleaned up.
- Isolated Chromium 153 browser fixtures passed selected storefront/COD, manager/viewer, settings, owner protection, temporary-password and session-reset scenarios. Next development may return HTTP 500 instead of 403 for rejected forged Server Actions; tested data was unchanged. Production-mode media/COD smoke used an injected JS test client. This is not a production runtime or complete RBAC proof.
- The embedded local DB helper created UTF-8 data and preserved Bengali across restart; the new local empty-DB preflight passed a fresh fixture and rejected a host override/nonempty DB. Backup syntax and stubs passed; no actual encrypted backup or restore was performed.
- `npm audit` and `npm audit --omit=dev`: **4 high, 0 critical/moderate** at review time in Prisma/config and transitive dependencies. Prisma 7 is a major suggested upgrade and has not been migrated or validated.
- Official Prisma engine download failed TLS in this sandbox; no TLS bypass was used. A successful `npx next build` with a JS/pg test client does not verify `npm run build` with the intended native client.

See [TESTING.md](TESTING.md) for commands and exact scope, and [LOCAL_SETUP_BN.md](LOCAL_SETUP_BN.md) for a new local setup.

## Next steps before a real release

1. Resolve or enforce a verified maintenance cutover that fences **all** old writers and reconciles in-flight provider requests; test both cutover and rollback. Do not mark the three failures as passing.
2. Inventory target migration history and historical stock/returns/credentials on a verified restored copy; test the additive migration with the official CLI and approved data plan. Existing short encryption keys and active courier claims require special handling, not a blind key replacement.
3. Verify the normal native Prisma install, production build/runtime, Docker/Nginx/TLS and persistent storage in the target environment. Establish and test encrypted database, uploads and key backups and an isolated restore.
4. Review four high dependency advisories, role/route authorization, logging and shared rate limiting. Validate each enabled provider with its real sandbox and reconciliation/rollback procedures before any production transaction.
