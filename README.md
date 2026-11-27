# DashTeam

Xceed Studio's internal HR and payroll system. Requirements are in [`docs/PRD.md`](docs/PRD.md). Conventions and hard rules are in [`CLAUDE.md`](CLAUDE.md).

## Run it locally

You need:

- **Node 24** (`nvm use` reads `.nvmrc`)
- **pnpm 12**: `corepack enable` (or `npm install -g pnpm@12`)
- **Docker Desktop**, running. The local database, sign-in and email all run in Docker. Nothing touches real data

```bash
pnpm install
pnpm db:start      # first run downloads the Supabase images (a few minutes); applies migrations and seed data
pnpm env:local     # writes .env.local from the running stack
pnpm dev           # http://localhost:3000
```

Sign in with one of the seeded people:

| Email | Role | Lands on |
| --- | --- | --- |
| `employee@dashteam.local` | employee | `/` |
| `admin@dashteam.local` | admin | `/admin` |

The 6-digit code arrives in the local mailbox at **http://127.0.0.1:54324**. No email leaves your machine.

Other useful commands:

```bash
pnpm typecheck && pnpm lint && pnpm test   # must pass before any task is done
pnpm test:db       # RLS tests against the local database
pnpm test:e2e      # Playwright: sign-in and role routing on desktop and phone, light and dark
                   # first time: pnpm exec playwright install chromium webkit
pnpm db:reset      # wipe the local database and re-apply migrations and seed
pnpm db:stop       # stop the containers
```

### Changing the database

1. Edit `src/lib/db/schema.ts`. Every table gets `.enableRLS()` and its policies (CI fails if a public table has RLS off)
2. `pnpm db:generate` writes a migration to `supabase/migrations`
3. `pnpm db:migrate` applies it locally (or `pnpm db:reset` to start clean)
4. Add RLS tests to `tests/db`

Functions, triggers and grants go in a custom migration: `pnpm exec drizzle-kit generate --custom --name=<what>`.

## How access works

- People sign in with a one-time email code. Accounts are **invite-only**: signups are off, so an unknown email can't create one
- Every account has a `profiles` row with a role: `admin` or `employee`. Interns are employees; "intern" is an employment type (milestone 2)
- People are added by an admin under **People**. Adding someone creates their sign-in for that email
- Access ends the day after a person's last working day. They are signed out, can't sign in again, and RLS shows them nothing; the admin still sees their record
- Every write to people, pay, change requests and roles is recorded in `audit_log` by database triggers. It can't be changed or removed, and any change can be undone for 10 minutes by whoever made it
- `/admin` is protected three times: the admin layout and every admin page call `requireRole("admin")` on the server; the app's database client runs every query as the signed-in person, so Postgres RLS applies; and RLS itself lets employees read only their own rows
- `src/proxy.ts` only refreshes the session and sends signed-out people to `/login`. It is not the security boundary

## Environments

| | Database | App |
| --- | --- | --- |
| Local | Supabase in Docker | `pnpm dev` |
| CI | Supabase in Docker, started fresh for each job | `pnpm build && pnpm start` for the e2e tests |
| Production | Supabase project `dashteam-prod` | Vercel production |

There is no hosted staging. Changes are proved locally and in CI, then reach production.

Migrations reach production through `.github/workflows/migrate.yml` on every push to `main` that changes `supabase/migrations`. It first runs the nightly backup workflow, saved under `pre-migration/` with the commit in its name and verified, and migrates only if that succeeded. The job connects with the `production` environment's `MIGRATE_DATABASE_URL`, so it reaches that one project and nothing else on the Supabase account.

**A free Supabase project pauses after 7 days without activity.** Backup and Migrate then stop at "Check the production database" with "The production project looks paused". Restore it in Supabase (open the project, then Restore project), wait until it shows Healthy, and run the workflow again from Actions.

### Setting up a hosted Supabase project (once per project)

In the Supabase dashboard, region **Singapore**:

1. **Authentication → Sign In / Providers**: Email on; "Allow new users to sign up" **off**; email OTP length **6**; OTP expiry **600** seconds
2. **Authentication → Emails → SMTP**: Resend SMTP (`smtp.resend.com`, port 465, user `resend`, password = a Resend API key), sender `DashTeam <no-reply@your-verified-domain>`. Supabase's built-in mailer only delivers to project members, about two emails an hour
3. **Authentication → Emails → Templates → Magic link**: subject "Your DashTeam sign-in code", body from `supabase/templates/sign-in-code.html`
4. **Add people**: Authentication → Users → "Add user" → "Send invitation" (or "Create new user" with "Auto confirm"). They get the `employee` role automatically
5. **Make the first admin** in the SQL editor:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'founder@example.com');
   ```

### Vercel

1. Import the GitHub repo. Framework preset: Next.js
2. Settings → Environment Variables, for **Production only**. Preview and Development get none: a preview must never reach production data or services, so delete any variables there:

   | Name | What it is | Where it comes from |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | The project's address (public) | Supabase → Connect |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (public) | Supabase → Project Settings → API Keys |
   | `DATABASE_URL` | **Transaction** pooler string, port 6543 | Supabase → Connect → Transaction pooler |
   | `SUPABASE_SECRET_KEY` | Creates and removes logins. Server only | Supabase → Project Settings → API Keys |
   | `FIELD_ENCRYPTION_KEY` | Encrypts TPN and bank account numbers | Generate: `openssl rand -base64 32`. A different key from your local one; keep the production key in the password manager |
   | `RESEND_API_KEY` | Sends payslips and other emails | Resend → API Keys, sending access only. Without it, production marks each email "not set up yet" |
   | `EMAIL_FROM` | Sender, e.g. `Xceed Studio <payroll@your-domain>` | A domain verified in Resend |
   | `APP_URL` | The app's address, for links in emails | Your Vercel domain. Without it, links point to localhost |
   | `CRON_SECRET` | Lets the daily filing reminder in | Generate: `openssl rand -hex 32`. **Production only**, the same value as the GitHub secret |

   Never set `ALLOW_TEST_CLOCK`, `FILING_TODAY` or `MAILPIT_URL` on a real deployment; they are for local development and tests.

DashTeam uses no Vercel-only services (no Vercel Postgres, KV, Blob, Edge Config or Cron).

### Fallback deployment (if Vercel is ever not an option)

The build is a standalone Node server (`output: "standalone"`), and all data lives in Supabase, so moving hosts needs no data migration:

```bash
pnpm install --frozen-lockfile && pnpm build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
PORT=3000 node .next/standalone/server.js
```

Run that on any Node 24 host (a VPS, Fly.io, Render, Railway, or a container) with the same environment variables as Vercel Production (the table above), behind HTTPS. Scheduled jobs already run on GitHub Actions, not on the host.

## GitHub

### Day-to-day workflow

One person works on DashTeam for now, so changes go straight to `main`:

1. Work locally and run `pnpm typecheck && pnpm lint && pnpm test` (plus `pnpm test:db` and `pnpm test:e2e` when touching the database or screens)
2. Commit and push to `main`. CI runs every check again and GitHub emails you if one fails; Vercel deploys to production

When a second person joins, add a branch ruleset on `main` that requires a pull request and these status checks: `typecheck`, `lint`, `test`, `db (RLS)`, `e2e`.

### Secrets and variables

Settings → Environments: create `production` and `backup`. They keep each set of secrets separate, and a job sees only its own environment's. CI needs none: it runs its own local Supabase.

Every workflow checks its settings first and names each missing one, then emails an alert (below) if anything fails.

| Name | Where in GitHub | Used by | What it is, and where it comes from |
| --- | --- | --- | --- |
| `MIGRATE_DATABASE_URL` | `production` environment secret | migrate | Production **session** pooler string, port 5432 (Supabase → Connect → Session pooler). The same string as `BACKUP_DATABASE_URL`, kept in its own environment |
| `BACKUP_DATABASE_URL` | `backup` environment secret | backup | Production **session** pooler string, port 5432 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | `backup` environment secrets | backup | Cloudflare R2: the bucket and an API token limited to it |
| `BACKUP_AGE_RECIPIENT` | `backup` environment **variable** | backup | The age **public** key only (see Backups) |
| `APP_URL` | repository secret | filing reminders | The production app's address |
| `CRON_SECRET` | repository secret | filing reminders | The same value as `CRON_SECRET` in Vercel Production |
| `ALERT_RESEND_API_KEY` | repository secret | alerts | A Resend API key with sending access only |
| `ALERT_EMAIL_TO` | repository secret | alerts | Who gets the alert emails |
| `ALERT_EMAIL_FROM` | repository **variable** | alerts | Sender on a domain verified in Resend, e.g. `DashTeam alerts <alerts@your-domain>` |

Session pooler strings work from GitHub's runners (IPv4); the direct connection is IPv6 only. The user in a session pooler string is `postgres.<project ref>`: copy it from Connect rather than typing it.

**Alerts.** When migrate, the nightly backup or the filing reminder fails, the last step emails `ALERT_EMAIL_TO` with the reason and a link to the run. If the alert settings are missing it says so in the run, and GitHub's own failure email still goes out.

## Encryption key

TPN and bank account numbers are encrypted in the app with `FIELD_ENCRYPTION_KEY` before they reach the database. The database and every backup hold only ciphertext.

- **Keep the production key in your password manager.** Without it, those fields can't be read, in the live database or in any backup.
- Never change the key in place: existing values would become unreadable. Key rotation is part of milestone 8.
- `pnpm env:local` generates a local key once and keeps it.

## Backups

Nightly at 02:00 Thimphu time, `.github/workflows/backup.yml` dumps production, encrypts it with [age](https://age-encryption.org), and uploads it to a private Cloudflare R2 bucket. Details and restore steps: [`scripts/backup/README.md`](scripts/backup/README.md).

One-time setup:

1. `age-keygen -o dashteam-backup.key`. Store this file in the password manager and **nowhere else**. Put the printed `age1…` public key in the `BACKUP_AGE_RECIPIENT` variable
2. Cloudflare R2: create a private bucket, add a lifecycle rule to delete objects under `daily/` after 35 days, and create an API token with Object Read & Write on that bucket only
3. Run the workflow once by hand (Actions → Nightly backup → Run workflow). It downloads what it uploaded and checks it, so a green run means the file is in R2 and whole
