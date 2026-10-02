# DashTeam

Xceed Studio's internal HR and payroll system. One company, internal only, roughly 10 users.
Full requirements: `docs/PRD.md`. Read it before planning any feature.

The month-end loop is the product: approve leave → run payroll → review → lock.
Locking emails payslips, produces the IT-1(a) TDS schedule, and shows what to remit to DRC by the 10th.

## Stack

- Next.js (App Router) + TypeScript, strict mode
- Supabase: Postgres + Auth (email one-time code, Google)
- Drizzle ORM, migrations in `supabase/migrations`
- Tailwind CSS
- react-pdf for payslips, statements, certificates
- Resend for email
- Vitest (unit), Playwright (end-to-end)
- Hosting: Vercel. Scheduled jobs and backups: GitHub Actions

Do not use Vercel-specific storage or services (Vercel Postgres, KV, Blob, Edge Config, Vercel Cron).
The app must stay deployable to another host with no data migration.

## Commands

```bash
pnpm dev              # local dev server
pnpm test             # unit tests (Vitest)
pnpm test:payroll     # payroll module + DRC fixture only
pnpm test:e2e         # Playwright
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm db:generate      # generate migration from schema
pnpm db:migrate       # apply migrations locally
```

Before saying a task is done: `pnpm typecheck && pnpm lint && pnpm test` must pass.

## Structure

```
src/
  app/                  # routes: (employee)/ and (admin)/ route groups
  components/           # shared UI, built on the design system
  modules/
    payroll/            # calculation engine. Pure functions, no I/O, no UI imports
    rules/              # dated rules: rates, TDS bands, leave entitlements, settings
    leave/
    people/             # employee records, employment types
    filing/             # IT-1(a) export, filing tracker, reminders
    documents/          # payslip, statement, certificate PDFs
    audit/
  lib/                  # db client, auth, email, money and date helpers
docs/
  PRD.md
  fixtures/drc_tds_table.csv
```

## Hard rules (never break these)

1. **No hardcoded rates.** TDS bands, HC rate, PF rate, GIS, leave entitlements and every setting live in `modules/rules` with an `effective_from` date. A payroll run uses the rules in force for its month.
2. **Locked runs are immutable.** A locked month stores a snapshot of every figure, rules version and employee detail used. Never update a locked run. Corrections are arrear or recovery lines in a later month.
3. **The payroll module is isolated.** `modules/payroll` contains pure functions only: input in, result out. No database calls, no network, no imports from UI or other modules except `rules` types.
4. **Money is integer chhertum** (1 Nu. = 100 Ch). Never use floats for money. Round only where the calculation spec says to.
5. **The DRC fixture must pass.** `docs/fixtures/drc_tds_table.csv` is checked on every change to `payroll` or `rules`. Never edit the fixture to make a test pass.
6. **Every write to pay, rules, leave or profiles creates an audit log entry** (actor, time, before, after). The audit table is append-only.
7. **Employees see only their own records.** Enforce with Supabase Row Level Security, not only in app code.
8. **Encrypt bank account numbers and TPN at field level.** Never log them, never send them to the client except to their owner or an admin.
9. **No automated submission to the DRC portal.** The system prepares the filing; a person submits it.

## Payroll calculation (summary; full spec in docs/PRD.md)

Order per person, per month:

1. Gross = basic + allowances + arrears + one-offs (interns: stipend + one-offs)
2. HC = 1% of gross, before deductions. Rounding per setting. Interns per setting
3. PF = rate × gross. Off until NPPF registration (2027), then from its effective date
4. GIS = not applicable to Xceed, stored as zero
5. Taxable = gross − PF − GIS
6. TDS = progressive bands on taxable, after rounding taxable **up** to the next Nu. 100; result rounded to nearest ngultrum
7. Take-home = gross − PF − GIS − TDS − HC

TDS band edges are stored as annual amounts divided by 12 (3L, 4L, 6.5L, 10L, 15L), rates 0, 10, 15, 20, 25, 30%.
Do not store the rounded monthly edges.

## Domain conventions

- Currency display: `Nu. 1,25,000` (Indian digit grouping, as DRC uses)
- Time zone: `Asia/Thimphu` for all dates, deadlines and reminders
- Payroll month = calendar month. TDS for month M is due on the 10th of month M+1
- Employment types: `full_time`, `intern`. Rules attach to the type, never to an individual
- Use the PRD's words in code and UI: payroll run, lock, payslip, stipend, IT-1(a), remittance, filing

## Workflow

- One milestone per branch and per PR, in this order:
  0. Scaffold, auth, roles, CI, nightly encrypted backup job
  1. Rules engine + payroll calculation module (DRC fixture passes; no UI)
  2. Employee records and employment types
  3. Leave: request, balance, approval, calendar
  4. Payroll run: calculate, adjust, review, lock
  5. Payslips: PDFs generated and emailed on lock
  6. IT-1(a) export and TDS filing tracker with reminders
  7. History: past payslips, pay statements, salary certificate, historical import
  8. Hardening: audit log review, field encryption, tested backup restore
- Start every feature in plan mode. Wait for approval of the plan before writing code
- Write tests alongside the code, not after. Payroll logic is test-first
- Keep PRs small enough to review in one sitting
- Never commit secrets. Use `.env.local`; keep `.env.example` current
- If a requirement is unclear or the PRD is silent, ask. Do not guess on anything touching money, tax or filing

## Code style

- TypeScript strict, no `any`. Validate all input at the boundary with Zod
- Server Components by default; Client Components only where interaction needs it
- Server Actions for mutations, each one checking role and writing the audit log
- Name things for the domain (`lockPayrollRun`, `calculateTds`), not generically (`handleSubmit2`)
- Comments explain why, not what

## User experience

DashTeam should feel like Apple made it: simple, calm, obvious. Every screen should make
sense the first time someone sees it, with nothing to learn and nothing to ignore.
This section is the standard. It overrides any skill or generic pattern when they conflict, including skills named in a prompt.
It sets the bar, not the layouts: explore and propose the best solution for each feature,
then check it against these principles.

### The test for every screen

Before building or merging a screen, answer three questions:
1. What is the one thing a person comes here to do? That action is the only primary button.
2. What can be removed without losing that? Remove it.
3. Would someone understand it with no explanation? If not, simplify it until they would.

### Principles

- **Simplicity is the work.** The rules engine, tax bands and snapshots carry the complexity so the screens never show it. If a screen feels complicated, the fix is usually in the logic, not the layout.
- **Clarity first.** Content leads, chrome recedes. Plain words, clear hierarchy, generous space. Never decorate.
- **One primary action per screen.** Everything else is secondary or lives one level deeper. A leave screen shows nothing about payroll.
- **Decide for the person.** Choose good defaults instead of adding settings. Pre-fill everything the system already knows. Never ask for the same thing twice.
- **Show, don't make them calculate.** Consequences appear live as people act: "This leaves you 18 days." "Take-home Nu. 41,250." No surprises after pressing a button.
- **Progressive disclosure.** Show the summary; reveal detail on tap. A payslip shows take-home first, the breakdown below.
- **Forgiving by default.** Every action can be undone, with a brief toast offering Undo. The one exception is locking payroll: it gets a calm review screen and a deliberate confirmation, because it emails payslips and freezes the month.
- **Immediate feedback.** Every tap responds within 100ms (pressed state, optimistic update or progress). Nothing ever feels like it did not register.
- **Consistency everywhere.** The same action looks and behaves the same on every screen. Same words, same placement, same motion.
- **Finished, not featured.** A feature is done only when its empty, loading, error and success states are designed and written. Fewer features, each complete.

### Visual language

- **Type:** system font stack (`-apple-system, BlinkMacSystemFont, "SF Pro", "Inter", sans-serif`). A small, strict scale: 34 large title, 22 title, 17 body, 15 secondary, 13 caption. Hierarchy comes from size and weight, not colour.
- **Numbers:** tabular figures for all money and dates so columns align. Money is the most important text on a pay screen: large, clear, never truncated.
- **Colour:** mostly neutral, one accent colour for primary actions and selection. Green, amber and red only for real status (approved, pending, declined, due soon). Full dark mode support.
- **Space:** 8-point grid. Generous padding; let content breathe. Group related items in rounded, inset sections like iOS Settings.
- **Shape and depth:** consistent corner radius (12 for cards, 8 for controls). Depth from subtle layering and translucency on bars and sheets, never heavy shadows or gradients.
- **Icons:** one consistent outline icon set (SF Symbols style), used sparingly and always paired with a label on first use.

### Interaction

- **Mobile-first for employees.** Thumb-reachable primary actions near the bottom. Bottom sheets for quick tasks (request leave, view payslip). Tap targets at least 44×44 points.
- **Admin is laptop-first** but must still work on a phone for approvals.
- **Motion has a purpose:** it shows where something came from or went, or confirms an action. Spring-based, quick (200 to 350ms), interruptible. No motion for decoration. Respect `prefers-reduced-motion`.
- **Speed is a feature.** Every employee screen usable in under one second on Bhutanese mobile data. Skeletons that match the final layout, never spinners on a blank page.

### Writing

- Write like a helpful person, not a system. Short, warm, specific. "Your leave is approved" not "Request status updated successfully."
- Use the person's words: "take-home", "leave left", "payslip". Never "record", "entity", "submission ID".
- Buttons say exactly what happens: "Request leave", "Lock September payroll", not "Submit" or "OK".
- Errors say what happened and what to do next, never blame the person, never show codes.
- Empty states invite the next step: "No leave requests yet. When someone asks for time off, it will show up here."
- No em dashes, no exclamation marks in system messages, no jargon.

### Accessibility

- WCAG AA contrast in light and dark mode
- Full keyboard navigation on admin screens, visible focus states
- Every control has an accessible name; status is never shown by colour alone
- Text scales with system font size settings without breaking layouts

## Do not

- Add features outside the current milestone, or anything from "After V1" in the PRD
- Add dependencies without saying why in the PR
- Build multi-company or multi-tenant support
- Change a past payroll month, the DRC fixture, or the audit log
- Use em dashes in any user-facing copy