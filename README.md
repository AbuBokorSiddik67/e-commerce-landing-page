# LANDIQ

LANDIQ is a self-hosted, single-tenant e-commerce landing page management application. One installation serves one business: create products and variants, build a separate landing page for each product, take Cash on Delivery orders, manage delivery and finances, and control staff permissions from one dashboard.

It is **not** a SaaS platform. There are no subscriptions, workspaces, tenant routing, artificial product limits or mandatory third-party accounts.

## What is implemented

- Next.js App Router + React + TypeScript (strict), Tailwind CSS, Lucide icons
- PostgreSQL + Prisma schema with migrations (40+ models), transaction-safe stock and order operations
- Session authentication, password hashing, reset flow, login history, RBAC with seven roles and server-side permission checks
- Product/category/variant/attribute management, media library with signature validation, inventory movements and low-stock alerts
- Section-based landing page builder (22 section types), six editable templates, drafts, versions, scheduling and publishing
- Public `/shop` catalog and browser cart, plus `/p/[slug]` product pages with variant/quantity selection, coupons, responsive previews, SEO metadata, JSON-LD, sitemap and redirects
- Single-product checkout (each cart item becomes a separate order) with COD, plus modular SSLCommerz, bKash and Nagad adapters with server-side callback verification
- Courier settings with optional Pathao, Steadfast and REDX adapters and a complete manual courier workflow
- Private `/track/[token]` pages with masked customer details, status timelines and cancellation of eligible pending COD orders
- Customers, returns, refunds, coupons, reviews, analytics and notification channels with delivery logs
- Marketing integrations (Meta Pixel/CAPI, Google Analytics, GTM) with server-side purchase events when configured
- Audit logs, CSP/security headers, rate limiting, encrypted provider credentials, CSRF origin checks
- Vitest + React Testing Library tests, Playwright spec, Docker/Nginx/backup tooling

See [docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md) for verified status and remaining limitations.

## Quick start

Requirements: Node.js 22+, npm, access to the official Prisma engine downloads, and a PostgreSQL database already matching the current `prisma/schema.prisma`.

**Database prerequisite:** the checked-in migration history does not yet bring an existing database to the current Phase 1 schema. The proposal in `docs/proposals/PHASE_1_ORDER_INVENTORY_MIGRATION.md` needs a separate, reviewed migration and historical-data verification. Do not run a reset, `db push`, seed, or migrations against an existing database without an approved backup and migration plan. The browser test fixture is disposable and is not an installation migration.

With a compatible database and the official Prisma engine available:

```bash
npm ci
test -f .env || cp .env.example .env
# Edit .env: set DATABASE_URL, NEXT_PUBLIC_SITE_URL and a long random CREDENTIALS_ENCRYPTION_KEY
npm run prisma:generate
npm run dev                 # binds 0.0.0.0:3000
```

Visit `/shop` to browse published products whose landing pages are published. Orders are placed separately for each cart item. Save the private confirmation/tracking link; eligible pending COD orders can be cancelled there. A new store also requires an authorized owner, enabled COD configuration, stock, and published product/landing-page records before it can accept orders.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit, component and database integration tests |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm run test:e2e` | Playwright browser workflows (requires installed browser) |
| `npm run prisma:migrate` | Create a migration after schema changes |
| `bash scripts/backup.sh` | Encrypted database backup |

## Architecture in one paragraph

`src/app` contains Server Components, Server Actions and Route Handlers; `src/components` holds reusable UI and public/dashboard components; `src/services` implements business workflows; `src/lib` contains validation, security, settings, integrations and provider adapters; `prisma` holds the schema, migrations and seed. Public requests never receive credentials, internal notes or full customer addresses. Server actions and APIs re-check permissions and payment/courier availability before doing work.

Full documentation: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md), [docs/API.md](docs/API.md), [docs/SECURITY.md](docs/SECURITY.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md), [docs/TESTING.md](docs/TESTING.md).

## Integration status

COD and manual courier are implemented and verified without any external credentials. Payment and courier provider adapters use real HTTP APIs and are isolated behind interfaces, but live transactions were **not** executed because no merchant accounts or API keys were available. Dashboard connection tests surface provider failures; disabled or unconfigured providers never appear at checkout. See [docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md).
