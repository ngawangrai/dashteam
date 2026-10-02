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
- `/admin` is protected three times: the admin layout and every admin page call `requireRole("admin")` on the server; the app's database client runs every query as the signed-in person, so Postgres RLS applies; and RLS itself lets employees read only their own rows
- `src/proxy.ts` only refreshes the session and sends signed-out people to `/login`. It is not the security boundary

## Environments

| | Database | App |
| --- | --- | --- |
| Local | Supabase in Docker | `pnpm dev` |
| Preview (every PR) | Supabase project `dashteam-staging` | Vercel preview URL |
| Production | Supabase project `dashteam-prod` | Vercel production |

Migrations reach staging and then production through `.github/workflows/migrate.yml` on every push to `main` that changes `supabase/migrations`. Production runs only if staging succeeds.

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

1. Import the GitHub repo. Framework preset: Next.js. Every PR gets a preview deployment automatically
2. Environment variables, from each Supabase project's **Connect** dialog:
   - **Preview** → staging values; **Production** → production values
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` (transaction pooler, port 6543)

DashTeam uses no Vercel-only services (no Vercel Postgres, KV, Blob, Edge Config or Cron).

### Fallback deployment (if Vercel is ever not an option)

The build is a standalone Node server (`output: "standalone"`), and all data lives in Supabase, so moving hosts needs no data migration:

```bash
pnpm install --frozen-lockfile && pnpm build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
PORT=3000 node .next/standalone/server.js
```

Run that on any Node 24 host (a VPS, Fly.io, Render, Railway, or a container) with the same three environment variables, behind HTTPS. Scheduled jobs already run on GitHub Actions, not on the host.

## GitHub

### Day-to-day workflow

One person works on DashTeam for now, so changes go straight to `main`:

1. Work locally and run `pnpm typecheck && pnpm lint && pnpm test` (plus `pnpm test:db` and `pnpm test:e2e` when touching the database or screens)
2. Commit and push to `main`. CI runs every check again and GitHub emails you if one fails; Vercel deploys to production

When a second person joins, add a branch ruleset on `main` that requires a pull request and these status checks: `typecheck`, `lint`, `test`, `db (RLS)`, `e2e`.

### Secrets and variables

Settings → Environments: create `staging`, `production` and `backup`. They keep each set of secrets separate.

| Name | Kind | Used by |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | secret | migrate |
| `STAGING_PROJECT_REF`, `STAGING_DB_PASSWORD` | secrets (staging) | migrate |
| `PROD_PROJECT_REF`, `PROD_DB_PASSWORD` | secrets (production) | migrate |
| `BACKUP_DATABASE_URL` | secret (backup) | backup. Production **session** pooler URL, port 5432 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | secrets (backup) | backup |
| `BACKUP_AGE_RECIPIENT` | variable (backup) | backup. The age **public** key only |

## Backups

Nightly at 02:00 Thimphu time, `.github/workflows/backup.yml` dumps production, encrypts it with [age](https://age-encryption.org), and uploads it to a private Cloudflare R2 bucket. Details and restore steps: [`scripts/backup/README.md`](scripts/backup/README.md).

One-time setup:

1. `age-keygen -o dashteam-backup.key`. Store this file in the password manager and **nowhere else**. Put the printed `age1…` public key in the `BACKUP_AGE_RECIPIENT` variable
2. Cloudflare R2: create a private bucket, add a lifecycle rule to delete objects under `daily/` after 35 days, and create an API token with Object Read & Write on that bucket only
3. Run the workflow once by hand (Actions → Nightly backup → Run workflow) and check the file appears in R2
