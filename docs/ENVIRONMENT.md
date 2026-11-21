# Environment

Copy `.env.example` to `.env` without overwriting an existing file. `.env` is Git-ignored, but still contains secrets: restrict access and never commit or share it. [LOCAL_SETUP_BN.md](LOCAL_SETUP_BN.md) gives the new local-development sequence. Existing installations require the separate review in [DEPLOYMENT.md](DEPLOYMENT.md).

| Variable | When | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL URL for the intended installation. Confirm the actual target before any write. |
| `NEXT_PUBLIC_SITE_URL` | Set explicitly | HTTP(S) **origin only**, no path/query/credentials; e.g. `https://store.example.com`. Used for links and callbacks and baked into the Next build. Default is localhost, which is not suitable for production. |
| `CREDENTIALS_ENCRYPTION_KEY` | Required for production credential use | Stable, secret, high-entropy key; at least **32 UTF-8 bytes** in production. Optional development fallback is public and unsafe for real secrets. Rotation and short legacy keys need a tested migration/reconciliation plan; do not blindly replace. |
| `APP_ENV` | Optional | Informational label, not a replacement for `NODE_ENV`. Production cookie/key rules depend on `NODE_ENV`. |
| `POSTGRES_PASSWORD` | Compose | Long random hexadecimal password for the Compose PostgreSQL user; hex avoids URL-encoding issues. Compose sets its own internal `DATABASE_URL`. |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD` | One-time seed only | Both required for a new empty database. Password: at least 16 characters, at most 72 UTF-8 bytes. No default owner credentials. Remove from environment after bootstrapping. |
| `SEED_INCLUDE_DEMO` | Seed only | `true` adds a demo product/page and opening stock ledger; default `false`. Seed refuses populated application tables. |
| `STORAGE_DRIVER` | Optional | `local` (default; files in `storage/uploads`) or `s3`. Older valid local keys can fall back to `public/uploads`. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` | S3 only | S3-compatible object storage settings. No automatic file migration; real S3 remains unverified. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email | SMTP transport; absent configuration causes a skipped delivery. Password reset email needs working SMTP in production. |
| `SMS_API_URL`, `SMS_API_TOKEN` | SMS | Gateway accepting `POST` JSON `{to, text}` with a bearer token. |
| `META_CAPI_ACCESS_TOKEN` | Optional | Server-side Meta Conversions API token. |
| `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` | Optional fallback | SSLCommerz credentials. |
| `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` | Optional fallback | bKash credentials. |
| `NAGAD_MERCHANT_ID`, `NAGAD_PUBLIC_KEY`, `NAGAD_PRIVATE_KEY` | Optional fallback | Nagad merchant and RSA keys. The current verifier cannot confirm a paid transaction without verified amount/currency. |
| `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `STEADFAST_API_KEY`, `STEADFAST_API_SECRET`, `REDX_API_KEY` | Optional fallback | Courier credentials. |
| `PATHAO_API_BASE`, `STEADFAST_API_BASE`, `REDX_API_BASE`, `NAGAD_API_BASE` | Optional | Provider endpoint overrides; review trust, environment and claim binding before changing. |
| `BACKUP_PASSPHRASE`, `BACKUP_DIR`, `RETENTION_DAYS` | Backup script | Separate encryption passphrase, output folder and non-negative retention days; see deployment guide. |

Dashboard provider credentials are encrypted when saved. Unreadable stored ciphertext fails closed rather than silently falling back to another account. Blank form fields preserve stored values; legacy plaintext is encrypted on a subsequent save. Configuration/credential changes can affect outstanding courier claims. Real provider behavior and existing audit/payload redaction are not fully verified.

## Development and testing only

- `npm run db:dev` uses fixed local-development credentials, binds PostgreSQL to `127.0.0.1`, and stores persistent data under `.postgres-data/`. It uses port `55432`; if needed, export `PG_PORT` in the helper's terminal **and** the preflight terminal and set the corresponding port in `DATABASE_URL`. It does not load `PG_PORT` from `.env` itself. An existing cluster keeps its original encoding; a new cluster uses UTF-8.
- `npm run db:check-empty` is a read-only preflight for that helper's **new, empty** `landiq` DB, not a check for arbitrary servers or an upgrade authorization. It refuses a nonempty DB.
- `LANDIQ_PREVIEW_EMBED=1` only for a cross-origin embedded **development** preview omits `X-Frame-Options`; leave it unset for normal development. Production keeps the header.
- `LANDIQ_SHOW_DEV_RESET_LINK=1` explicitly exposes password-reset links in development responses. Leave it unset except on an isolated loopback-only disposable test installation: anyone who can reach it and supply an account email can take over that account. It has no effect in production.
- Test opt-ins and destructive-test warnings are in [TESTING.md](TESTING.md). `npm test` is selected safe suites only.

The normal Prisma client/build needs trusted access to the official Prisma engine download. It was unavailable due to TLS in this environment; the injected JS test client is not a substitute. Never bypass TLS verification or use an unverified engine to get a green build.
