#!/usr/bin/env bash
# Nightly backup: dump the production database, encrypt it, upload it to a private R2 bucket, then
# download it again and check it arrived whole.
#
# Required environment:
#   BACKUP_DATABASE_URL    production session pooler URL (port 5432; GitHub runners have no IPv6)
#   BACKUP_AGE_RECIPIENT   age public key (age1...). The private key is kept offline, never in GitHub.
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
# Optional:
#   BACKUP_REASON          nightly (default) or pre-migration, when Migrate runs it before a migration
#   R2_ENDPOINT            another S3 endpoint, only for testing this script against a local store
set -euo pipefail

: "${BACKUP_DATABASE_URL:?missing}" "${BACKUP_AGE_RECIPIENT:?missing}"
: "${R2_ACCOUNT_ID:?missing}" "${R2_ACCESS_KEY_ID:?missing}" "${R2_SECRET_ACCESS_KEY:?missing}" "${R2_BUCKET:?missing}"

reason="${BACKUP_REASON:-nightly}"
day="$(TZ=Asia/Thimphu date +%F)"
case "$reason" in
  nightly) name="dashteam-${day}.dump.age" ;;
  # Its own name, so it never replaces that night's file, and the commit it came before.
  pre-migration)
    commit="${GITHUB_SHA:-local}"
    name="dashteam-${day}-$(TZ=Asia/Thimphu date +%H%M)-${commit:0:7}.dump.age"
    ;;
  *) echo "::error title=Backup::BACKUP_REASON must be nightly or pre-migration, not ${reason}."; exit 1 ;;
esac
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Stops the run with a reason the alert email can include.
fail() {
  echo "::error title=Backup::$1"
  if [ -n "${RUNNER_TEMP:-}" ]; then echo "$1" >> "$RUNNER_TEMP/alert.txt"; fi
  exit 1
}

# Stream straight into age so an unencrypted dump never touches the disk.
# Custom format keeps it restorable table by table; the auth schema is included so people can sign in after a restore.
# On the way past, pg_restore reads the dump's table of contents (names only, no data), so a dump
# missing the tables that matter fails tonight rather than on the day it's needed. It stops reading
# once it has the list; cat drains the rest so tee doesn't fail on a closed pipe.
if ! pg_dump "$BACKUP_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=auth \
  | tee >(pg_restore --list > "$workdir/contents.txt" 2> /dev/null; cat > /dev/null; touch "$workdir/contents.done") \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$workdir/$name"; then
  fail "Dumping or encrypting the database failed. The step's log above has pg_dump's own message."
fi

for _ in $(seq 1 60); do
  [ -f "$workdir/contents.done" ] && break
  sleep 1
done
for table in "public payroll_snapshots" "public audit_log" "public people" "auth users"; do
  if ! grep -q "TABLE DATA ${table} " "$workdir/contents.txt" 2> /dev/null; then
    fail "The dump has no data for ${table/ /.}, so it wasn't uploaded."
  fi
done
tables="$(grep -c " TABLE DATA " "$workdir/contents.txt")"

# A dump that is suspiciously small means something went wrong upstream.
size="$(stat -c %s "$workdir/$name")"
if [ "$size" -lt 1024 ]; then
  fail "The backup is only ${size} bytes, so it wasn't uploaded."
fi

(cd "$workdir" && sha256sum "$name" > "$name.sha256")
expected="$(cut -d ' ' -f 1 "$workdir/$name.sha256")"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
endpoint="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"

upload() {
  aws s3 cp "$workdir/$name" "s3://${R2_BUCKET}/$1/$name" --endpoint-url "$endpoint" --only-show-errors \
    || fail "Uploading the $1 backup to R2 failed."
  aws s3 cp "$workdir/$name.sha256" "s3://${R2_BUCKET}/$1/$name.sha256" --endpoint-url "$endpoint" --only-show-errors \
    || fail "Uploading the $1 checksum to R2 failed."
}

# Downloads what R2 now holds and checks it is the file made above, byte for byte. Decrypting needs
# the private key, which never comes to GitHub; the restore drill proves that part.
verify() {
  local copy="$workdir/check/$1"
  mkdir -p "$copy"
  aws s3 cp "s3://${R2_BUCKET}/$1/$name" "$copy/$name" --endpoint-url "$endpoint" --only-show-errors \
    || fail "The $1 backup couldn't be downloaded again from R2."
  aws s3 cp "s3://${R2_BUCKET}/$1/$name.sha256" "$copy/$name.sha256" --endpoint-url "$endpoint" --only-show-errors \
    || fail "The $1 checksum couldn't be downloaded again from R2."
  [ "$(cut -d ' ' -f 1 "$copy/$name.sha256")" = "$expected" ] \
    || fail "The $1 checksum in R2 isn't the one made before upload."
  (cd "$copy" && sha256sum --quiet --check "$name.sha256") \
    || fail "The $1 backup in R2 doesn't match its checksum."
  [ "$(head -c 21 "$copy/$name")" = "age-encryption.org/v1" ] \
    || fail "The $1 backup in R2 isn't an age-encrypted file."
}

# daily/ expires after 35 days (bucket lifecycle rule); monthly/ and pre-migration/ are kept for good.
if [ "$reason" = "pre-migration" ]; then
  upload pre-migration
  verify pre-migration
else
  upload daily
  verify daily
  if [ "$(TZ=Asia/Thimphu date +%d)" = "01" ]; then
    upload monthly
    verify monthly
  fi
fi

echo "Uploaded and verified ${name}: ${size} bytes, data for ${tables} tables."
