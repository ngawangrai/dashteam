# Backups

`backup.sh` runs nightly from `.github/workflows/backup.yml` at 02:00 Thimphu time.

1. Checks its settings and that the production database answers (a paused project is named as such)
2. `pg_dump` (custom format) of the production `public` and `auth` schemas, through the Supabase session pooler
3. Streamed straight into `age`, encrypted to a public key. GitHub never holds the key that decrypts it.
   On the way past, `pg_restore --list` reads the dump's table of contents (names only, no data); the run
   stops if there is no data for `payroll_snapshots`, `audit_log`, `people` or `auth.users`
4. Uploaded with a `.sha256` checksum to the private R2 bucket: `daily/` (kept 35 days by a lifecycle rule) and, on the 1st, `monthly/` (kept for good)
5. Downloaded again from R2 and checked: the checksum in R2 must be the one made before upload, the file must
   match it, and it must be an age file. Anything else fails the run

Decrypting needs the private key, which never comes to GitHub, so a nightly run can't prove that part.
The restore drill does.

A failed run emails `ALERT_EMAIL_TO` with the reason and a link to the run (settings in the main README).
GitHub's own workflow-failure email is the fallback.

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
