# Security

## Implemented controls

- **Authentication:** bcrypt password hashes (cost 12), 32-byte random session tokens stored only as SHA-256 hashes, 30-day expiry, server-side revocation (`revokedAt`), login history, failed-login lockout (8 attempts / 15 minutes), password reset tokens that are single-use and expire in one hour.
- **Authorization:** Seven roles; Owner resolves to all permissions and cannot be downgraded through staff UI. Every dashboard action calls `requirePermission()`; public tracking uses an explicit field allow-list.
- **Input validation:** Zod schemas for products, pages, orders, coupons, settings, media, auth and public APIs. Section content is restricted to structured text/images, preventing script injection.
- **Transport/browser:** Strict CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By`, HttpOnly/SameSite cookies, `secure` cookies in production. Server Actions rely on Next.js origin checks; public write APIs additionally compare `Origin` with `Host`.
- **Rate limiting:** Login, tracking, order placement, review submission and analytics events. Process-local by default; use a shared limiter for multi-instance deployments.
- **Secrets:** Provider credentials encrypted with AES-256-GCM using `CREDENTIALS_ENCRYPTION_KEY`; ciphertext is stored in configuration JSON and never returned to the browser (password fields are blank placeholders). API access tokens remain in environment variables.
- **Payments:** Server-side verification with provider APIs, amount comparison, webhook event deduplication, idempotent transaction claiming, no card data stored. Redirects never mark an order paid by themselves.
- **Media:** MIME allow-list plus magic-byte signature validation, 20 MB limit, generated object keys, local disk or S3-compatible storage. Uploads require a staff session.
- **Privacy:** Public tracking masks phone numbers, omits street addresses and internal notes, and uses unpredictable tokens. Customer profiles require staff permission.
- **Auditability:** Login/logout, settings changes, provider configuration, order status, stock, refunds, media and staff changes are recorded in AuditLog with redacted payloads.

## Known limitations

- The default rate limiter is per process. Run one application instance or add a shared Redis-compatible limiter before horizontal scaling.
- CSP includes `'unsafe-inline'` and `'unsafe-eval'` for Next.js and optional marketing script injection. Tighten with nonces if your deployment requires a stricter policy.
- SMTP/SMS channels are logged as `SKIPPED` when credentials are absent; the system never claims delivery in that case.
- Provider adapters were reviewed against documented API structures but could not be executed against live merchant accounts; see [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md).
- Backups are encrypted only as strongly as the operator's `BACKUP_PASSPHRASE`; store the passphrase separately and test restores.
