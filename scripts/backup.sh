#!/usr/bin/env bash
set -euo pipefail

# Encrypted plain-SQL PostgreSQL backup. Keep BACKUP_PASSPHRASE separate from
# the backup and test restores in a distinct, verified disposable database.
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "RETENTION_DAYS must be a non-negative integer" >&2; exit 1; }
umask 077
mkdir -p -- "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TEMP="$(mktemp "$BACKUP_DIR/.landiq-$STAMP.XXXXXX")"
trap 'rm -f -- "$TEMP"' EXIT
FILE="$BACKUP_DIR/landiq-$STAMP-${TEMP##*.}.sql.gz.gpg"

# A failed pg_dump/gzip/gpg must not leave a file that looks like a complete
# backup. Pass the encryption passphrase over an fd, not in command arguments.
pg_dump "$DATABASE_URL" | gzip | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase-fd 3 --output "$TEMP" 3<<<"$BACKUP_PASSPHRASE"
chmod 600 "$TEMP"
mv -- "$TEMP" "$FILE"
find "$BACKUP_DIR" -name 'landiq-*.gpg' -type f -mtime "+$RETENTION_DAYS" -delete
echo "Backup created: $FILE"
