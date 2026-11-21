# Deployment readiness and operations

LANDIQ is a single-business installation. **The current tree is not approved for production deployment or upgrade.** The configuration files are a starting point, not evidence that a deployment is safe.

## Release blockers

1. **Old/new writer overlap is unsafe.** Three unskipped disposable PostgreSQL tests reproduce stock being released while a pre-upgrade courier booking may exist, or an old writer booking a cancelled order. No enforceable fence or verified cutover/rollback is provided. Stop and independently fence *all* old writers, jobs, callbacks, replicas and rollback paths before any cutover; drain and reconcile in-flight provider requests, including those without a local record. Merely waiting, restarting or changing an app flag does not prove an external request did not succeed. Test the actual fence and rollback plan. Do not use a rolling upgrade until compatibility or equivalent controls are proven.
2. **Migration and existing data.** `20261120060000_phase1_order_inventory` is additive and its SQL passed synthetic PostgreSQL tests, but the official `prisma migrate deploy` path and the target installation's migration history and data have not been verified. Review legacy variant attributes, returns, stock, payments, courier claims, constraints and migration history on a restored copy. A database formerly provisioned by `db push` must not blindly receive the migration history. Do not infer or auto-repair historical stock or returns.
3. **Native build and runtime.** Official Prisma engine downloads failed TLS in this environment. A Next production-mode build and smoke used an injected JS/pg *test* client, not the intended native production client. Verify a clean install, official `prisma generate`, migration/seed runner, production build and runtime with trusted official engines in the intended environment.
4. **Backups and recovery.** The backup script has syntax and stub tests only; encryption, a real `pg_dump`, restore, file backups and recovery time have not been verified. Establish encrypted off-host backups and perform an isolated restore drill before any real change.
5. **Infrastructure and integrations.** Docker/Compose, Nginx/TLS, S3, SMTP, SMS, payment/courier sandbox and live transactions are unverified. The current Nagad adapter does not supply the verified amount/currency needed to confirm a paid order; it requires adapter work and sandbox evidence. An internal refund is not provider payout proof. Keep unverified providers disabled.
6. **Security review.** On the latest audit, `npm audit` and `npm audit --omit=dev` each reported **4 high** findings, in the Prisma/config dependency chain (`deepmerge-ts` and `effect` included). The suggested Prisma 7 upgrade is a major migration, not an automatic safe fix. Review dependencies, role/route coverage, sensitive historical data, logging, rate limiting and proxy configuration before release.

No real deployment, provider call, existing database change or real backup/restore was performed in this review. [TESTING.md](TESTING.md) gives the precise evidence and limits.

## Credential key and existing installations

`CREDENTIALS_ENCRYPTION_KEY` is used to decrypt provider credentials and to bind courier claims to their configuration. Production now requires at least **32 UTF-8 bytes**. Generate a long random key for a *new* installation, store it separately and keep it stable; `NEXT_PUBLIC_SITE_URL` is not a secret.

**Do not simply replace an existing shorter key.** It may encrypt stored credentials, and claims may bind both the key and the existing ciphertext. A new key can make credentials unreadable and prevent claim resolution. Before any approved rotation:

- Stop/fence writers and reconcile active or uncertain courier operations and provider requests; never assume they are safe because they are old.
- Back up the database, uploads and the original key separately; verify restoration to a distinct disposable copy.
- Design and test a controlled decrypt/re-encrypt and claim-reconciliation plan on that copy, including failure and rollback with the original key. There is no turnkey key-rotation migration in this repository. Existing plaintext credentials and historical audit records also need a restricted-access review.
- If those steps cannot be completed, **hold the upgrade**. Do not save over unreadable credentials or delete evidence to unblock it.

## Configuration to validate after blockers are resolved

- Provision an isolated PostgreSQL database/user with approved privileges, TLS, monitoring and a reviewed migration plan. Set a stable random key, final `https://` public origin and production secrets outside Git. `NEXT_PUBLIC_SITE_URL` is baked into the Next build and must match the public origin; rebuilding is required when it changes.
- Terminate HTTPS at a trusted reverse proxy. Configure real certificates and the correct `server_name`; test renewals, secure cookies and forwarded headers. The provided Nginx config overwrites `X-Forwarded-For` and disables access logs because tracking/reset URLs are capabilities. Other proxies, CDNs, app logs and APM must also avoid leaking those URLs. Verify HTTPS and proxy trust yourself.
- `docker-compose.yml` defines PostgreSQL, app and Nginx, with `pgdata` and `uploads` volumes; the app port is not published. The app image runs non-root and does not migrate or seed automatically. Compose and volume permissions have **not** been tested here. Do not put bootstrap credentials in a long-lived `env_file`; remove them after the one-time new-installation seed.
- Local files are written under `storage/uploads`, served dynamically at `/uploads/...`; valid older files under `public/uploads` remain readable. Compose mounts one volume at both locations for legacy URLs. Back up both locations for non-Compose installations, or the appropriate S3 bucket. Changing storage drivers does not migrate existing files.
- `/api/health` checks database connectivity only; it does not prove schema, provider or backup readiness. Set up alerting and review unresolved payment, courier and refund claims; do not automatically retry or delete ambiguous claims.

## Backup and restore planning

`scripts/backup.sh` streams **plain SQL** from `pg_dump` through gzip and symmetric GPG encryption, creates a restrictive file and removes matching old files after a successful backup. It needs `pg_dump`, `gzip`, `gpg`, `DATABASE_URL`, and a separate `BACKUP_PASSPHRASE`; `BACKUP_DIR` defaults to `./backups` and `RETENTION_DAYS` to 14. It does not back up uploaded files or encryption keys. Check permissions, retention, off-host copying and storage capacity. These operations have not been tested with the real tools here.

An eventual restore drill must use a **new, explicitly identified disposable target**, never an ambiguous `DATABASE_URL`; a plain-SQL dump is restored with `psql`, not `pg_restore`. Restore changes the target database and may fail part-way if the procedure is not transactional. After authorization and identity/emptiness verification, an operator can adapt this *untested* Bash outline:

```bash
# Set BACKUP_FILE and RESTORE_DATABASE_URL only after independently verifying
# that the destination is a new disposable DB, and never to the source DB.
: "${BACKUP_FILE:?Set an encrypted backup file}"
: "${RESTORE_DATABASE_URL:?Set the verified disposable restore target}"
read -r -s -p 'Backup passphrase: ' BACKUP_PASSPHRASE; echo
set -o pipefail
gpg --batch --pinentry-mode loopback --passphrase-fd 3 --decrypt "$BACKUP_FILE" 3<<<"$BACKUP_PASSPHRASE" \
  | gzip -dc | psql -X --set=ON_ERROR_STOP=1 --single-transaction --dbname "$RESTORE_DATABASE_URL"
unset BACKUP_PASSPHRASE
```

Keep the passphrase, credential-encryption key and backups separately; restore the matching key and uploaded files on the isolated copy. Verify counts, sample pages/orders/media, authentication and reconciliation evidence. A backup is not proven usable until that drill succeeds. See [DATABASE.md](DATABASE.md) and [SECURITY.md](SECURITY.md).
