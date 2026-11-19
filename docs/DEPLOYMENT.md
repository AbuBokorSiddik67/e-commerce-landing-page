# Deployment

LANDIQ is installed independently for one business. No multi-tenant routing or shared SaaS hosting is involved.

## Production checklist

1. Provision PostgreSQL 17+ with a dedicated database/user.
2. Set a long random `CREDENTIALS_ENCRYPTION_KEY` (32+ bytes) and keep it outside Git.
3. Set `NEXT_PUBLIC_SITE_URL` to the final public origin.
4. Configure HTTPS at Nginx/your reverse proxy; set secure cookies automatically via `NODE_ENV=production`.
5. Apply migrations, seed once, then change the default owner password.
6. Configure delivery charges, policies, business profile and payment methods (COD needs no credentials).
7. Verify `/api/health`, publish a test page and place one COD order.
8. Enable encrypted backups and schedule restore testing.

## Docker Compose

```bash
cp .env.example .env
# set POSTGRES_PASSWORD, CREDENTIALS_ENCRYPTION_KEY, NEXT_PUBLIC_SITE_URL
mkdir -p certs   # place fullchain.pem and privkey.pem for your domain
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run db:seed
```

`docker-compose.yml` starts PostgreSQL, the Next.js application container and Nginx. Uploads persist in the `uploads` volume; the database persists in `pgdata`. Update TLS files and the `server_name` in `nginx.conf` before going live.

## Manual Node deployment

```bash
npm ci
npm run build
DATABASE_URL=... npx prisma migrate deploy
npm start
```

Run behind a reverse proxy with HTTPS. The Docker image copies `.next`, `node_modules`, `public` and `prisma` into a slim runtime layer and starts with `npm start`.

## Object storage

Local disk is the default (`public/uploads`, excluded from Git). For S3-compatible storage set `STORAGE_DRIVER=s3` plus bucket/endpoint/credentials. Existing local files are not migrated automatically.

## Backups and restore

`scripts/backup.sh` creates an AES-256-encrypted `pg_dump` with a retention window:

```bash
export DATABASE_URL='postgresql://...'
export BACKUP_PASSPHRASE='a-separate-long-random-secret'
BACKUP_DIR=/srv/landiq/backups bash scripts/backup.sh
```

Restore (will overwrite the target database — test on a copy first):

```bash
gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" --output dump.sql.gz backup.gpg
gunzip dump.sql.gz
pg_restore --clean --if-exists --dbname "$DATABASE_URL" dump.sql   # for custom-format dumps
# For the plain SQL produced by pg_dump, use: psql "$DATABASE_URL" -f dump.sql
```

Also back up `public/uploads` (or the S3 bucket) and the environment file/passphrase store separately. A restore is not considered verified until it has been performed on a staging database and `/api/health` plus a sample order/page have been checked there.

## Monitoring

- `GET /api/health` for liveness/database checks.
- Provider status and last error are visible in Payment Settings and Courier & Shipping.
- Notification delivery logs show actual provider acceptance/skip/failure.
- Application errors are emitted to the process logger; ship them to your preferred log collector.

## Upgrades

Take a backup, apply migrations with `npx prisma migrate deploy`, rebuild, and restart. Never delete the `.git` directory or run destructive Git operations on the installation checkout.
