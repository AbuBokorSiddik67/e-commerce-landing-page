# API

Route Handlers are used for public write endpoints, callbacks, exports and media. Dashboard mutations use Server Actions declared in `src/app/actions`.

## Public endpoints

| Endpoint | Method | Authentication | Description |
| --- | --- | --- | --- |
| `/api/health` | GET | none | Database connectivity probe |
| `/api/orders` | POST | none, rate limited, same-origin | Place an order. Returns `orderNumber`, `trackingToken`, `total`, `checkoutUrl` (null for COD) |
| `/api/delivery-quote` | POST | none, same-origin | Server-computed delivery charge for a district/area/subtotal |
| `/api/events` | POST | none, rate limited, same-origin | Record `page_view`, `view_content`, `cta_click`, `initiate_checkout` with a pseudonymous visitor ID |
| `/api/reviews` | POST | none, rate limited, same-origin | Submit a review. Status is always `PENDING`; verified status requires a delivered matching order |
| `/track/[token]` | GET | unguessable token, rate limited | Customer tracking page with masked details |

Example order payload:

```json
{
  "productId": "...", "variantId": "...", "quantity": 1,
  "customer": { "name": "Buyer", "phone": "01700000000", "email": "buyer@example.com",
    "address": "Street 1", "district": "Rajshahi", "area": "City" },
  "deliveryOption": "inside_city", "paymentMethod": "cod", "couponCode": "WELCOME10",
  "idempotencyKey": "a-random-uuid-v4-generated-for-this-checkout"
}
```

The illustrative `idempotencyKey` must be replaced with a cryptographically random UUIDv4, retained for retries with the same order details and treated as a secret capability. It is optional for legacy clients, whose time-window duplicate guard is weaker. Separate keys are separate order intentions; this is not unconditional exactly-once processing. The backend revalidates `paymentMethod`; a method hidden or disabled in the dashboard is rejected even if a client sends it. Each cart line creates a separate order.

## Payment callbacks

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/payments/{provider}/callback` | GET, POST | Provider return URL; verifies server-side then redirects to confirmation/failure page |
| `/api/payments/{provider}/ipn` | POST | Provider IPN/webhook; verifies server-side and returns JSON |

Accepted `provider` values: `sslcommerz`, `bkash`, `nagad`. Callback identifiers locate an existing transaction; the adapter queries the provider and a paid confirmation requires matching reference, amount, currency and locked order/payment evidence. A known verified reference gets at most one diagnostic `WebhookEvent`; the locked payment state is authoritative, not that event or a browser redirect. Untrusted callback bodies are not persisted as event payloads. Disabled providers reject callbacks. POST bodies are limited to 64 KiB and callback/IPN rate limits are process-local. All real provider flows remain unverified; Nagad currently lacks verified amount/currency for paid confirmation.

## Protected endpoints

| Endpoint | Method | Permission | Description |
| --- | --- | --- | --- |
| `/api/media` | GET, POST | `media.write` | List or upload validated media (multipart `file`, `folder`, `alt`) |
| `/api/orders/export` | GET | `orders.view` | CSV export of orders with applied filters |

## Server Actions

Actions live in `src/app/actions/{auth,products,pages,orders,settings,catalog,staff,contact}.ts`. Each dashboard action starts with `requirePermission()` and redirects back with `?error=` or `?success=`. Important groups: product/category CRUD, page save/publish/template, order status/cancel/COD/courier, settings and provider configuration, coupons, reviews, returns, refunds, customers, media, staff, contact.

## SEO routes

`/sitemap.xml` includes published, indexable pages. `/robots.txt` disallows dashboard, API, tracking, auth and confirmation routes. `/p/[slug]/page.tsx` emits canonical, Open Graph, Twitter and Product/Organization/Breadcrumb JSON-LD based only on visible data.
