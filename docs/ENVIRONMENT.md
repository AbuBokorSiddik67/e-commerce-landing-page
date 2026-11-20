# Environment

Copy `.env.example` to `.env` and replace every placeholder. `.env` and `.env.*` are ignored by Git (except the example file).

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string for this installation |
| `NEXT_PUBLIC_SITE_URL` | Production | Absolute public origin used in canonical URLs, callbacks and sitemap |
| `APP_ENV` | No | Informational environment label |
| `CREDENTIALS_ENCRYPTION_KEY` | Production | Long random secret used to derive the AES-256-GCM key for provider credentials |
| `STORAGE_DRIVER` | No | `local` (default) or `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` | S3 only | S3-compatible object storage |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email notifications | SMTP transport. If unset, email channel logs `SKIPPED` |
| `SMS_API_URL`, `SMS_API_TOKEN` | SMS notifications | Provider endpoint accepting `POST {to, text}` with bearer token |
| `META_CAPI_ACCESS_TOKEN` | Meta CAPI | Server-side Conversions API token (never shown in dashboard) |
| `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` | Optional fallback | Environment fallback for SSLCommerz credentials |
| `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` | Optional fallback | bKash tokenized checkout credentials |
| `NAGAD_MERCHANT_ID`, `NAGAD_PUBLIC_KEY`, `NAGAD_PRIVATE_KEY` | Optional fallback | Nagad RSA keys (PEM text with `\n` escapes accepted) |
| `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET` | Optional fallback | Pathao OAuth credentials |
| `STEADFAST_API_KEY`, `STEADFAST_API_SECRET` | Optional fallback | Steadfast credentials |
| `REDX_API_KEY` | Optional fallback | REDX API key |
| `PATHAO_API_BASE`, `STEADFAST_API_BASE`, `REDX_API_BASE`, `NAGAD_API_BASE` | No | Override provider base URLs for sandbox/regional endpoints |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD` | No | Override first owner credentials during seed |

Provider credentials can be entered in the dashboard instead of environment variables; dashboard values are encrypted in the database and take precedence. Never commit real credentials.

## Development-only variables

`scripts/dev-db.ts` uses `PG_PORT=55432` by default and writes its cluster to `.postgres-data/` (Git-ignored). Test configuration is in `tests/setup.ts` and `vitest.config.ts`.

For a cross-origin embedded development preview only, set `LANDIQ_PREVIEW_EMBED=1` when starting `next dev`. This omits the `X-Frame-Options` header for that preview; leave it unset for normal development. Production retains the header even if the flag is set.

Prisma engine downloads in this sandbox required a local mirror via `PRISMA_ENGINES_MIRROR`; normal installations can omit it and use the official Prisma download endpoint.
