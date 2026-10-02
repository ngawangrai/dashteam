# Backups

`backup.sh` runs nightly from `.github/workflows/backup.yml` at 02:00 Thimphu time.

1. `pg_dump` (custom format) of the production `public` and `auth` schemas, through the Supabase session pooler
2. Streamed straight into `age`, encrypted to a public key. GitHub never holds the key that decrypts it
3. Uploaded with a `.sha256` checksum to the private R2 bucket: `daily/` (kept 35 days by a lifecycle rule) and, on the 1st, `monthly/` (kept for good)

A failed run emails the repository's watchers through GitHub's standard workflow-failure notification.

## Restoring

You need the age **private key** (kept offline by the founder) and a Postgres 17 client.

```bash
# 1. Download the file and its checksum from R2, then check it
sha256sum -c dashteam-2026-10-02.dump.age.sha256

# 2. Decrypt
age --decrypt --identity ~/path/to/dashteam-backup.key \
  --output dashteam-2026-10-02.dump dashteam-2026-10-02.dump.age

# 3. Restore into an EMPTY Supabase project (never over production)
pg_restore --no-owner --no-privileges --clean --if-exists \
  --dbname "$TARGET_SESSION_POOLER_URL" dashteam-2026-10-02.dump
```

Delete the decrypted `.dump` as soon as you are done. It contains salary and bank data in the clear.

A full restore drill, timed and written up, is part of milestone 8 and must pass before go-live.
