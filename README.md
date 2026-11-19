# LANDIQ

LANDIQ is a self-hosted, single-tenant e-commerce landing page management application. One installation serves one business: create products and variants, build a separate landing page for each product, take Cash on Delivery orders, manage delivery and finances, and control staff permissions from one dashboard.

It is **not** a SaaS platform. There are no subscriptions, workspaces, tenant routing, artificial product limits or mandatory third-party accounts.

## What is implemented

- Next.js App Router + React + TypeScript (strict), Tailwind CSS, Lucide icons
- PostgreSQL + Prisma schema with migrations (40+ models), transaction-safe stock and order operations
- Session authentication, password hashing, reset flow, login history, RBAC with seven roles and server-side permission checks
- Product/category/variant/attribute management, media library with signature validation, inventory movements and low-stock alerts
- Section-based landing page builder (22 section types), six editable templates, drafts, versions, scheduling and publishing
- Public `/p/[slug]` renderer with variant/quantity selection, coupons, responsive previews, SEO metadata, JSON-LD, sitemap and redirects
- Checkout with COD as a fully independent default, plus modular SSLCommerz, bKash and Nagad adapters with server-side callback verification
- Courier settings with optional Pathao, Steadfast and REDX adapters and a complete manual courier workflow
- Secure `/track/[token]` pages with masked customer details and status timelines
- Customers, returns, refunds, coupons, reviews, analytics and notification channels with delivery logs
- Marketing integrations (Meta Pixel/CAPI, Google Analytics, GTM) with server-side purchase events when configured
- Audit logs, CSP/security headers, rate limiting, encrypted provider credentials, CSRF origin checks
- Vitest + React Testing Library tests, Playwright spec, Docker/Nginx/backup tooling

See [docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md) for verified status and remaining limitations.

## Quick start

Requirements: Node.js 22+, PostgreSQL 17+ (or the bundled development PostgreSQL script), npm.

```bash
npm install
cp .env.example .env
# Edit .env: set DATABASE_URL and a long random CREDENTIALS_ENCRYPTION_KEY

npm run prisma:deploy       # apply migrations
npm run db:seed             # create owner, roles, settings, templates and demo product
npm run dev                 # http://localhost:3000
```

Seeded demo owner: `owner@landiq.local` / `Owner@123456789`. **Change this password immediately on any real installation.**

Public demo storefront: `http://localhost:3000/p/premium-cotton-t-shirt`

### Optional local PostgreSQL (no system install)

```bash
npx tsx scripts/dev-db.ts   # starts embedded PostgreSQL on 127.0.0.1:55432
```

Use `postgresql://landiq:landiq_dev_password@127.0.0.1:55432/landiq?schema=public` as `DATABASE_URL`.

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
