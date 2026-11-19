# Changelog

## 1.0.0 — initial implementation

- Added Next.js App Router TypeScript strict codebase, Tailwind design system and dashboard shell.
- Added Prisma PostgreSQL schema with migrations, seed data and transaction-safe services.
- Added session authentication, password reset, RBAC, staff management and audit logging.
- Added product, category, variant, media and inventory modules with stock movements.
- Added section-based landing page builder, templates, versions, scheduling and public renderer.
- Added SEO metadata, JSON-LD, sitemap, robots.txt and redirect rules.
- Added checkout, COD accounting, order management, invoice export and secure tracking.
- Added modular SSLCommerz, bKash and Nagad adapters with server-side verification and idempotency.
- Added optional Pathao, Steadfast and REDX adapters plus a complete manual courier workflow.
- Added customers, coupons, reviews, returns, refunds, notifications and analytics.
- Added marketing integrations, security headers, rate limiting, credential encryption and upload validation.
- Added Vitest/RTL tests (33 passing), Playwright spec, Docker, Nginx and encrypted backup tooling.

Live provider transactions and browser E2E execution remain environment-dependent; see [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md).
