# LANDIQ

LANDIQ is a self-hosted, single-business e-commerce application: manage products and stock, build landing pages, accept Cash on Delivery (COD) orders, track deliveries and manage staff. It is not a multi-tenant SaaS platform.

> **Not ready for production deployment.** Three safety assertions still fail when old and new order writers overlap; the official Prisma build/migration/seed CLI, existing installation data, Docker/TLS, real backups/restores and live providers have not been verified in this environment. See [deployment readiness](docs/DEPLOYMENT.md) and [test results](docs/TESTING.md) before planning a release.

## Local setup

Start with the **[বাংলা local setup guide](docs/LOCAL_SETUP_BN.md)**. It walks through a *new, empty local development database*, owner setup and the demo product. It does not authorize resets or changes to an existing database.

Node.js 22.12+ (Node 22 LTS recommended), npm, a supported embedded PostgreSQL platform and access to the official Prisma engine download are needed. An additive Phase 1 migration is now checked in, and its SQL was exercised on synthetic databases; the official Prisma CLI flow and compatibility with existing installations remain unverified. Never run migration, seed, `db push` or a reset against existing data without a reviewed plan and tested backup.

## What is available

- Product variants, stock movements, media uploads, landing-page builder, templates and publishing.
- `/shop`, browser-local cart and product pages. **Each cart line becomes a separate order**, not one combined checkout.
- COD checkout, private tracking links, eligible customer cancellation, manager order handling, manual/shop delivery, receipt/inspection-based returns and internal refund records.
- Session authentication, staff roles, mandatory temporary-password changes, settings and selected server-side permission checks.
- Payment and courier adapters, notifications, marketing integrations and storage options. External services remain unverified; keep them disabled until separately tested.

A cancellation can be recorded without returning stock when physical or financial evidence is uncertain. A return report does not credit stock until staff record and inspect a physical receipt. An internal refund record is not proof that money was paid back. Protect tracking/reset links as secrets.

## Commands

| Command | Use |
| --- | --- |
| `npm run db:dev` | Start the persistent, loopback-only local embedded PostgreSQL helper |
| `npm run db:check-empty` | Read-only preflight for the documented **new empty** embedded local DB only |
| `npm run prisma:generate` | Generate the normal Prisma client; requires official engine download |
| `npm run prisma:deploy` | Apply checked-in migrations; **new local DB or separately approved target only** |
| `npm run db:seed` | One-time owner bootstrap of an empty migrated DB; explicit credentials required |
| `npm run dev` | Development server on port 3000 |
| `npm test` | Selected unit, component and mocked-service suites, not all DB/E2E tests |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run build` / `npm start` | Intended production build/server; not yet verified with the normal native Prisma client here |

The historical destructive integration and Playwright suites need explicit opt-in and a dedicated disposable database; their opt-ins do **not** verify database identity. Prefer the identity-verified fixture suites described in [TESTING.md](docs/TESTING.md).

Further documentation: [Environment](docs/ENVIRONMENT.md) · [Database](docs/DATABASE.md) · [Security](docs/SECURITY.md) · [Implementation status](docs/IMPLEMENTATION_PROGRESS.md) · [API](docs/API.md) · [Architecture](docs/ARCHITECTURE.md).
