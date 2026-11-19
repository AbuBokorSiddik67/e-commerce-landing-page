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
  "deliveryOption": "inside_city", "paymentMethod": "cod", "couponCode": "WELCOME10"
}
```

The backend revalidates `paymentMethod`; a method hidden or disabled in the dashboard is rejected even if a client sends it.

## Payment callbacks

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/payments/{provider}/callback` | GET, POST | Provider return URL; verifies server-side then redirects to confirmation/failure page |
| `/api/payments/{provider}/ipn` | POST | Provider IPN/webhook; verifies server-side and returns JSON |

Accepted `provider` values: `sslcommerz`, `bKash`, `nagad`. Callback data is never trusted: the adapter calls the provider's validation or query API, compares the amount, and claims the transaction with `verifiedAt IS NULL` so duplicate events are ignored. Disabled providers reject callbacks.

## Protected endpoints

| Endpoint | Method | Permission | Description |
| --- | --- | --- | --- |
| `/api/media` | GET, POST | `media.write` | List or upload validated media (multipart `file`, `folder`, `alt`) |
| `/api/orders/export` | GET | `orders.view` | CSV export of orders with applied filters |

## Server Actions

Actions live in `src/app/actions/{auth,products,pages,orders,settings,catalog,staff,contact}.ts`. Each dashboard action starts with `requirePermission()` and redirects back with `?error=` or `?success=`. Important groups: product/category CRUD, page save/publish/template, order status/cancel/COD/courier, settings and provider configuration, coupons, reviews, returns, refunds, customers, media, staff, contact.

## SEO routes

`/sitemap.xml` includes published, indexable pages. `/robots.txt` disallows dashboard, API, tracking, auth and confirmation routes. `/p/[slug]/page.tsx` emits canonical, Open Graph, Twitter and Product/Organization/Breadcrumb JSON-LD based only on visible data.
