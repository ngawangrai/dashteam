# DashTeam: MVP PRD

Oct 2, 2026 · @Ngawang Chojey Rai

## Summary

DashTeam is Xceed Studio's internal HR and payroll system. It turns month-end into one loop: approve leave, review payroll, lock. Locking emails payslips to employees and interns, produces the IT-1(a) TDS schedule for the DRC portal, and shows what to remit before the 10th. Every rate and policy lives in a dated rules config, so a change is one edit and past months never move.

Internal only, single company, built with AI under one owner. The bar is Apple-level simplicity: few features, each finished completely.

## Problem and goals

Payroll and leave run on manual edits today. Each rate or policy change means updating records by hand, payslips are made one at a time, and the IT-1(a) schedule is rebuilt every month for a mandatory DRC filing due by the 10th. All of it depends on the founder.

**Goals**

- Month-end payroll takes under 30 minutes from leave approval to lock
- TDS and HC filed with DRC by the 10th every month, with no manual preparation
- A policy or rate change takes one edit, effective from a date, without touching past months
- Employees and interns get their own payslips and leave balances without asking anyone
- Any past payslip can be reproduced exactly as it was issued

## Users and roles

| Role | Who | Main jobs | Device |
| --- | --- | --- | --- |
| Admin | Founder now, a delegate later | Approve leave, run and lock payroll, maintain rules, file TDS | Laptop |
| Employee | Full-time staff | Request leave, check balances, view and download payslips | Phone first |
| Intern | Interns on stipend | Same as employee, with intern leave rules and a stipend payslip | Phone first |

Employment type is a field on the person, not a separate app. Rules (pay components, deductions, leave) attach to the type, so adding a new type later (contract, part-time) is configuration, not code.

## V1 features

V1 covers leave, the monthly payroll run, payslips and the TDS filing. Nothing else ships until three payroll runs have matched to the ngultrum.

**Employee and intern app (mobile-first)**

1. Home: leave balances, latest payslip, nothing else
2. Request leave: pick type and dates, see the remaining balance update live, add an optional note, submit
3. Leave history: each request with its status (pending, approved, declined)
4. Payslips: every month since joining, view, download PDF, email to self
5. Pay statement: choose a date range (for example 6 or 12 months) and download one PDF
6. Salary certificate: request a one-page letter confirming employment and current pay
7. Profile: contact, bank details, TPN; changes go to admin for approval

**Admin**

1. Employees: name, employment type, TPN, bank account, basic pay, allowances or stipend, start date, end date, active or exited
2. Leave approvals: one inbox, one-tap approve or decline with an optional note
3. Team calendar: who is out and when
4. Monthly payroll run: auto-calculate, adjust one-offs (arrears, bonus, advance recovery, unpaid leave), review, lock
5. On lock, automatically:
   1. PDF payslips emailed to everyone in the run (salary or stipend layout)
   2. IT-1(a) schedule, exported for upload and shown copy-ready for manual entry
   3. Remittance summary: total TDS + HC due to DRC, with the due date
   4. Bank transfer list: net pay per person
6. TDS filing tracker: status per month, reminders, acknowledgement record (see below)
7. Payslip lookup: any person, any locked month, view or re-send, including people who have left
8. Rules config and settings (see below)
9. Audit log: every change to pay, rules, leave or profiles, with who and when

## Payroll calculation

Each person's pay is calculated in this fixed order, using the rules in force for that month.

1. **Gross** = basic + allowances + arrears + one-offs (interns: stipend + one-offs)
2. **HC** = 1% of gross, before any deduction; rounding per setting; applies to interns only if the intern HC setting is on
3. **PF** = rate × gross; off until NPPF registration in 2027, then on from its effective date
4. **GIS** = not applicable to Xceed; kept as a rule set to zero
5. **Taxable** = gross − PF − GIS
6. **TDS** = progressive bands on taxable, after rounding taxable **up** to the next Nu. 100; result rounded to the nearest ngultrum
7. **Take-home** = gross − PF − GIS − TDS − HC

**TDS bands (DRC Annexure III, revised schedule for monthly salary income)**

| Monthly taxable salary (Nu.) | Rate on the portion in band | Annual equivalent (Nu.) |
| --- | --- | --- |
| 0 to 25,000 | 0% | up to 3,00,000 |
| 25,001 to 33,333 | 10% | 3,00,001 to 4,00,000 |
| 33,334 to 54,167 | 15% | 4,00,001 to 6,50,000 |
| 54,168 to 83,333 | 20% | 6,50,001 to 10,00,000 |
| 83,334 to 1,25,000 | 25% | 10,00,001 to 15,00,000 |
| Above 1,25,000 | 30% | above 15,00,000 |

Band edges are stored as annual figures divided by 12, not as the rounded monthly numbers above. This method reproduces all 1,319 rows of the DRC table exactly (Nu. 0 to 1,67,400) and DRC's worked example above that (Nu. 20,208 at 1,25,000, plus 30% of the excess).

**Acceptance test (required)**

- The full DRC table is checked into the repo as a fixture. Every row must pass before any change to payroll code is merged.
- Fixtures also cover: zero-TDS stipend, PF switched on mid-year, an arrear month, unpaid leave, an exit mid-month.

## Monthly TDS filing

TDS and HC for the previous month must be filed and paid on the DRC portal by the 10th. The system prepares everything; the admin submits on the portal by hand.

&#91;embedded content: month-end flow · 4 steps, 4 automatic outputs, 1 manual filing\]

Only the portal submission is manual (dashed); everything else follows from the lock.

**Filing states per month:** Draft (payroll not locked) → Ready (locked, schedule generated) → Filed (submitted, acknowledgement recorded).

**What the system does**

- Shows "TDS due in N days" on the admin home from the 1st until filed
- Reminds the admin on the 5th and 8th if the month is not marked Filed
- Generates the IT-1(a) schedule from the locked run, in the official column order: name, TPN, basic, allowance, arrear, gross, PF, GIS, net, TDS, HC, total (TDS + HC)
- Offers two outputs: an upload file for the portal, and a copy-ready screen (one person per row, copy buttons per field) for manual entry
- Shows the total to pay: TDS + HC
- On "Mark as filed": records filing date, payment reference and the portal acknowledgement (number or uploaded receipt)
- Includes or excludes interns from the schedule per the intern setting

**What it does not do:** log in to the DRC portal or submit on the admin's behalf. Filing is mandatory, and a silent automation failure would mean a missed deadline.

## Payslip history and documents

A locked month is permanent. Its run stores the exact figures, rules version and employee details used, so a payslip pulled a year later matches what was issued.

- **Employees and interns:** payslips for every month since joining; view, download, email to self
- **Admin:** any person, any locked month, including people who have left; view, download, re-send
- **Corrections:** past months are never edited. A correction is an arrear or recovery line in the current month, and the original payslip stays as issued, consistent with what was filed with DRC
- **Pay statement:** one PDF covering a chosen range of months, for bank loans
- **Salary certificate:** one-page letter on Xceed letterhead confirming role, start date and current pay; generated on request, logged in the audit log
- **Historical import:** past payroll months can be imported once as locked historical runs, so older payslips are available from day one

## Rules and settings

Every rule has an effective-from date. A payroll run uses the rules in force for its month, so a new rate never rewrites a locked month. Nothing below is hardcoded.

| Rule or setting | V1 value | Applies to |
| --- | --- | --- |
| TDS bands | Six bands above, from DRC Annexure III | Employees; interns per setting |
| Health contribution | 1% of gross | Employees; interns per setting |
| HC rounding | Setting: nearest, down or up to the ngultrum (unresolved, default nearest) | All |
| PF | Off; turned on with rate and date at NPPF registration in 2027 | Employees |
| GIS | Not applicable, set to zero | All |
| Interns on IT-1(a) | Setting: include or exclude (unresolved, default include) | Interns |
| HC on intern stipends | Setting: on or off (unresolved, default on) | Interns |
| Salary components | Basic, allowance, arrear | Employees |
| Stipend | Single amount | Interns |
| Leave: annual | 25 days | Employees |
| Leave: sick | 14 days | Employees |
| Leave: professional development | 5 days | Employees |
| Leave: maternity, paternity, bereavement, family emergency | Per policy | Employees |
| Leave: intern entitlement | To be set | Interns |
| Carry-forward limits | To be set | Per leave type |
| Filing reminders | 5th and 8th of the month | Admin |

Defaults for unresolved settings are placeholders until the accountant confirms. Changing a setting writes an audit log entry.

## Experience principles

Simple on the surface, hard underneath: the rules engine carries the complexity so every screen stays calm.

- **One primary action per screen.** Leave screens show nothing about payroll.
- **Defaults over forms.** Never ask for what the system already knows. Offer half days when they make sense.
- **Show consequences live.** "This leaves you 18 days" while dates are being picked; "Take-home Nu. 41,250" while a one-off is being entered.
- **Undo over confirmation.** Every action can be undone, except locking payroll, which gets a real review and confirmation.
- **Calm states.** Empty, pending, approved and error screens each have a short, human line of copy.
- **Fast on local data.** Under one second on Bhutanese mobile networks for every employee screen.
- **Finished, not featured.** Each V1 feature ships with its empty state, errors, loading and mobile layout done. A new feature must replace something or come up twice before it is built.
- **Shared design system.** The same type, spacing, colour and motion as Xceed's other internal tools and Dash products.

## Data, security and retention

Salary, bank and TPN data are the most sensitive records Xceed holds; they are treated that way from the first commit.

- **Access:** employees and interns see only their own records; admin role limited to the founder and one named delegate
- **Login:** email sign-in with a one-time code or Google, no shared accounts
- **Encryption:** in transit (HTTPS) and at rest; bank account numbers and TPN encrypted at field level
- **Backups:** automated daily, covering the full history, with a restore tested before go-live
- **Audit log:** append-only; records actor, time, before and after values
- **Retention:** locked runs, payslips, schedules and filing records kept for at least the period DRC requires (to be confirmed); exited employees' records are kept, with their app access closed on their end date
- **Generated files:** payslip, schedule and statement PDFs stored per month, not regenerated from live data

## After V1

**V2, only after three clean payroll runs**

- Expense claims with the Nu. 5,000 and Nu. 15,000 approval thresholds
- Year-end tax summary per person for their PIT filing
- Contracts and offer letters stored per person
- Monthly journal entry export for the accountant or DashBooks

**Later, not scheduled**

- Attendance
- Performance reviews
- Org chart
- Analytics dashboards
- Multi-company or external customers
- Automated submission to the DRC portal, if DRC ever offers an API

## Success metrics and go-live

| Metric | Target |
| --- | --- |
| Parallel run vs current method | Matches to the ngultrum for one full month |
| Admin time per payroll month | Under 30 minutes by month two |
| Manual edits to IT-1(a) before filing | Zero |
| Late TDS filings | Zero |
| Payslip or leave questions to the founder | Near zero; staff self-serve in the app |

**Go-live checklist**

- [ ] Accountant confirms TDS method, HC rounding and intern treatment
- [ ] DRC table fixture passes in CI
- [ ] Employee records, TPNs and bank details entered and checked
- [ ] Historical payroll months imported (optional)
- [ ] Backup restore tested
- [ ] One month run in parallel and matched
- [ ] Team onboarded on phones

## Open questions

| Question | Who answers | Handled in V1 by |
| --- | --- | --- |
| HC rounding method | Accountant or DRC | Setting, default nearest ngultrum |
| Interns on IT-1(a) | Accountant or DRC | Setting, default include |
| HC on intern stipends | Accountant or DRC | Setting, default on |
| Exact upload file format the DRC portal accepts | Founder, from the portal | Export matched to the portal before build of the export step |
| NPPF employee and employer rates | Accountant, at 2027 registration | PF rule off until then |
| Record retention period required by DRC | Accountant | Keep everything until confirmed |
| Intern leave entitlement and carry-forward limits | Founder | Config values to be set |
| Product name | Founder | Decided: DashTeam |
| Merge owner (Niraj or Karma) | Founder | Needed before build starts |

## Build guardrails

Built with AI, owned by people. These rules keep the codebase understandable as features get added.

- **Product owner:** the founder decides what gets built
- **Merge owner:** one engineer reviews and merges every change; anyone can request
- **Pull requests only:** no direct edits to production
- **Spec in the repo:** this PRD and a short data-model note live in the repo and go into every AI prompt
- **Tests gate merges:** the DRC table fixture and payroll fixtures must pass
- **Timing:** not built during heavy delivery windows (AMIS, BIF); client work and DashTicket come first
- **Time cap:** a fixed build budget, agreed before starting; overrun means stop and reassess, not push through
- **Sequence:** payroll and leave first; the PM tool starts only after payroll has run cleanly for a month

**Architecture:** one employee record shared by two modules, HR (people, leave, documents) and payroll (calculation, payslips, filing). The payroll calculation is an isolated module with its own tests, so HR screens can change without any risk to how TDS is calculated.