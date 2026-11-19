# Architecture

LANDIQ is a Single-Tenant Modular Monolith. Every installation has its own database and owns one business. There is no tenant discriminator, shared schema or SaaS control plane.

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Presentation | `src/app`, `src/components` | Server Components, forms, visual builder, public renderer, marketing site |
| Application | `src/app/actions`, `src/app/api` | Input binding, authorization entry points, redirects/JSON responses |
| Business services | `src/services` | Products, inventory, pages, orders, coupons, reviews, returns, customers, analytics, media |
| Domain helpers | `src/lib` | Pricing, validation, permissions, crypto, settings, notifications, marketing |
| Integration | `src/lib/payments`, `src/lib/couriers`, `src/lib/storage.ts` | Provider adapters and object storage behind interfaces |
| Data | `prisma/schema.prisma`, `src/lib/prisma.ts` | PostgreSQL schema, migrations, transactions |

## Request flows

**Dashboard form:** Server Action → `requirePermission()` → Zod validation in service → Prisma transaction → `audit()` → `revalidatePath()` → redirect with success/error query message.

**Public order:** `/p/[slug]` renders published sections and passes the server-computed list of available payment methods into the checkout form. `POST /api/orders` validates again, re-checks method availability, calculates delivery server-side, atomically decrements stock with `updateMany({ stock: { gte: qty } })`, records stock movement and returns either an order confirmation token or the provider redirect URL.

**Payment callback:** `/api/payments/[provider]/callback` (or `/ipn`) → adapter calls the provider's verification/query API → transaction lookup → amount check → idempotent `verifiedAt` claim → order payment/financial update → audit + notification + optional CAPI Purchase event. Frontend redirects are never trusted as proof of payment.

**Tracking:** `/track/[token]` queries an explicit allow-list of fields, rate-limits by IP, masks the phone number and never renders the street address or internal notes.

## Module boundaries

- Provider credentials never cross into client components; `getCheckoutPaymentMethods()` returns only code, name, default flag and sandbox flag.
- Payment and courier adapters implement small interfaces (`PaymentProvider`, `CourierProvider`). Adding a provider does not change order creation logic.
- Section data is validated with `sectionDataSchema` (text, numbers, images and arrays only). No user HTML, JavaScript or `dangerouslySetInnerHTML` reaches section content.
- Static marketing pages do not query the database at build time; public and dashboard routes are dynamic.

## Notable decisions

- Money is stored as integer BDT taka, avoiding floating point drift. Fraction amounts are outside the current scope and documented rather than silently rounded.
- Each product has one landing page (`LandingPage.productId` is unique). Slugs are unique across pages, and redirect rules handle old URLs.
- Sessions are random high-entropy tokens; only their SHA-256 hashes are stored. Revocation is a timestamp on the session row.
- In-app rate limiting is process-local. A multi-instance deployment needs a shared limiter; see [SECURITY.md](SECURITY.md).
