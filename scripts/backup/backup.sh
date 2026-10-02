#!/usr/bin/env bash
# Nightly backup: dump the production database, encrypt it, upload it to a private R2 bucket.
#
# Required environment:
#   BACKUP_DATABASE_URL    production session pooler URL (port 5432; GitHub runners have no IPv6)
#   BACKUP_AGE_RECIPIENT   age public key (age1...). The private key is kept offline, never in GitHub.
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
set -euo pipefail

: "${BACKUP_DATABASE_URL:?missing}" "${BACKUP_AGE_RECIPIENT:?missing}"
: "${R2_ACCOUNT_ID:?missing}" "${R2_ACCESS_KEY_ID:?missing}" "${R2_SECRET_ACCESS_KEY:?missing}" "${R2_BUCKET:?missing}"

day="$(TZ=Asia/Thimphu date +%F)"
name="dashteam-${day}.dump.age"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Stream straight into age so an unencrypted dump never touches the disk.
# Custom format keeps it restorable table by table; the auth schema is included so people can sign in after a restore.
pg_dump "$BACKUP_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=auth \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$workdir/$name"

# A dump that is suspiciously small means something went wrong upstream.
size="$(stat -c %s "$workdir/$name")"
if [ "$size" -lt 1024 ]; then
  echo "Backup is only ${size} bytes; refusing to upload." >&2
  exit 1
fi

(cd "$workdir" && sha256sum "$name" > "$name.sha256")

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

upload() {
  aws s3 cp "$workdir/$name" "s3://${R2_BUCKET}/$1/$name" --endpoint-url "$endpoint" --only-show-errors
  aws s3 cp "$workdir/$name.sha256" "s3://${R2_BUCKET}/$1/$name.sha256" --endpoint-url "$endpoint" --only-show-errors
}

# daily/ expires after 35 days (bucket lifecycle rule); monthly/ is kept for good.
upload daily
if [ "$(TZ=Asia/Thimphu date +%d)" = "01" ]; then
  upload monthly
fi

echo "Uploaded ${name} (${size} bytes)"
