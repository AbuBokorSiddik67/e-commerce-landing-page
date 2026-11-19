#!/usr/bin/env bash
set -euo pipefail

# Encrypted PostgreSQL backup with retention. Configure DATABASE_URL and
# BACKUP_PASSPHRASE in the environment (or an ops secret store).
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/landiq-$STAMP.sql.gz.gpg"

pg_dump "$DATABASE_URL" | gzip | gpg --batch --yes --symmetric --cipher-algo AES256 \
  --passphrase "$BACKUP_PASSPHRASE" --output "$FILE"
chmod 600 "$FILE"
find "$BACKUP_DIR" -name 'landiq-*.gpg' -type f -mtime "+$RETENTION_DAYS" -delete
echo "Backup created: $FILE"
