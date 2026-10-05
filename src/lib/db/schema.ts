import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  integer,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUid, authUsers, authenticatedRole } from "drizzle-orm/supabase";
import { EMPLOYMENT_TYPES, LEAVE_TYPES, RULE_KEYS } from "@/modules/rules/types";
import { LINE_KINDS, LINE_SOURCES } from "@/modules/run/lines";

// Interns sign in as employees; "intern" is an employment type, not a role.
export const appRole = pgEnum("app_role", ["admin", "employee"]);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: appRole("role").notNull().default("employee"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // No insert, update or delete policies: rows are created by the auth.users trigger,
    // and roles change only through SQL or a future audited admin action.
    pgPolicy("profiles_select_own_or_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.id} = ${authUid} or (select public.is_admin())`,
    }),
  ],
).enableRLS();

export type Profile = typeof profiles.$inferSelect;
export type AppRole = (typeof appRole.enumValues)[number];

// Rules attach to an employment type, never to a person. People get this type in milestone 2.
export const employmentType = pgEnum("employment_type", EMPLOYMENT_TYPES);
export const ruleKey = pgEnum("rule_key", RULE_KEYS);

/**
 * Every rate and setting, dated. Append-only: a trigger rejects updates, so a change is a new row
 * with a later effective_from and past months never move. Values are validated by modules/rules/schema.ts.
 */
export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: ruleKey("key").notNull(),
    employmentType: employmentType("employment_type").notNull(),
    // Payroll month = calendar month, so a rule always starts on the 1st.
    effectiveFrom: date("effective_from").notNull(),
    value: jsonb("value").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => authUsers.id),
  },
  (table) => [
    unique("rules_key_type_effective_from").on(table.key, table.employmentType, table.effectiveFrom),
    check("rules_effective_from_first_of_month", sql`extract(day from ${table.effectiveFrom}) = 1`),
    // Admins read rules. Writes come later as an audited admin action, never directly through the API.
    pgPolicy("rules_select_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select public.is_admin())`,
    }),
    // Rates and leave policy aren't secret, and everyone's leave balance is worked out from them.
    pgPolicy("rules_select_with_access", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select public.has_access())`,
    }),
    // The one rule an admin sets in the app: payroll settings (the first month), from the Payroll screen.
    // Rates and leave policy are still changed only by a migration. Audited by trigger.
    pgPolicy("rules_insert_settings_admin", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select public.is_admin()) and ${table.key} = 'payroll_settings'`,
    }),
    pgPolicy("rules_delete_settings_admin", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select public.is_admin()) and ${table.key} = 'payroll_settings'`,
    }),
  ],
).enableRLS();

export type Rule = typeof rules.$inferSelect;

// People: one record per person ever employed. Exited people keep their record; status is derived
// from end_date (exited once it is before today in Thimphu), so it can never drift.
// TPN and bank account are encrypted in the app (lib/crypto/field.ts); only ciphertext and the last 4 are stored.
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .unique()
      .references(() => profiles.id, { onDelete: "set null" }),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    bankName: text("bank_name"),
    bankAccountCiphertext: text("bank_account_ciphertext"),
    bankAccountLast4: text("bank_account_last4"),
    tpnCiphertext: text("tpn_ciphertext"),
    tpnLast4: text("tpn_last4"),
    startDate: date("start_date").notNull(),
    // Last working day. They keep access until the end of this day.
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("people_email_unique").on(sql`lower(${table.email})`),
    check("people_email_lowercase", sql`${table.email} = lower(${table.email})`),
    check("people_end_after_start", sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`),
    check(
      "people_bank_account_pair",
      sql`(${table.bankAccountCiphertext} is null) = (${table.bankAccountLast4} is null)`,
    ),
    check("people_tpn_pair", sql`(${table.tpnCiphertext} is null) = (${table.tpnLast4} is null)`),
    pgPolicy("people_select_own_or_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.id} = (select public.current_person_id()) or (select public.is_admin())`,
    }),
    pgPolicy("people_insert_admin", { for: "insert", to: authenticatedRole, withCheck: sql`(select public.is_admin())` }),
    pgPolicy("people_update_admin", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select public.is_admin())`,
      withCheck: sql`(select public.is_admin())`,
    }),
  ],
).enableRLS();

export type Person = typeof people.$inferSelect;

// Employment terms, dated. A raise or a change of type is a new row from the 1st of a month;
// rows are never updated, and only rows starting this month or later can be removed.
export const payRecords = pgTable(
  "pay_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    employmentType: employmentType("employment_type").notNull(),
    basicCh: bigint("basic_ch", { mode: "number" }),
    allowancesCh: bigint("allowances_ch", { mode: "number" }),
    stipendCh: bigint("stipend_ch", { mode: "number" }),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => authUsers.id),
  },
  (table) => [
    unique("pay_records_person_effective_from").on(table.personId, table.effectiveFrom),
    check("pay_records_first_of_month", sql`extract(day from ${table.effectiveFrom}) = 1`),
    check(
      "pay_records_fields_match_type",
      sql`(${table.employmentType} = 'full_time' and ${table.basicCh} is not null and ${table.allowancesCh} is not null and ${table.stipendCh} is null)
       or (${table.employmentType} = 'intern' and ${table.stipendCh} is not null and ${table.basicCh} is null and ${table.allowancesCh} is null)`,
    ),
    check(
      "pay_records_not_negative",
      sql`coalesce(${table.basicCh}, 0) >= 0 and coalesce(${table.allowancesCh}, 0) >= 0 and coalesce(${table.stipendCh}, 0) >= 0`,
    ),
    pgPolicy("pay_records_select_own_or_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
    }),
    pgPolicy("pay_records_insert_admin", { for: "insert", to: authenticatedRole, withCheck: sql`(select public.is_admin())` }),
    pgPolicy("pay_records_delete_admin", { for: "delete", to: authenticatedRole, using: sql`(select public.is_admin())` }),
  ],
).enableRLS();

export type PayRecord = typeof payRecords.$inferSelect;

export const changeRequestStatus = pgEnum("change_request_status", ["pending", "approved", "declined", "withdrawn"]);

// A person asks to change their own contact or bank details; an admin approves or declines.
// Only the fields being changed are filled. The bank account is encrypted for the same person and field,
// so approving copies the ciphertext across without decrypting it.
export const profileChangeRequests = pgTable(
  "profile_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => authUsers.id),
    phone: text("phone"),
    bankName: text("bank_name"),
    bankAccountCiphertext: text("bank_account_ciphertext"),
    bankAccountLast4: text("bank_account_last4"),
    status: changeRequestStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => authUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("profile_change_requests_one_pending")
      .on(table.personId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "profile_change_requests_something_changes",
      sql`${table.phone} is not null or ${table.bankName} is not null or ${table.bankAccountCiphertext} is not null`,
    ),
    check(
      "profile_change_requests_bank_account_pair",
      sql`(${table.bankAccountCiphertext} is null) = (${table.bankAccountLast4} is null)`,
    ),
    pgPolicy("profile_change_requests_select_own_or_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
    }),
    pgPolicy("profile_change_requests_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.personId} = (select public.current_person_id()) and ${table.status} = 'pending' and ${table.requestedBy} = ${authUid}`,
    }),
    // Allowed transitions are enforced by a trigger: admins decide, owners withdraw.
    pgPolicy("profile_change_requests_update_own_or_admin", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
      withCheck: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
    }),
  ],
).enableRLS();

export type ProfileChangeRequest = typeof profileChangeRequests.$inferSelect;

// Append-only record of every write to people, pay, change requests and profiles. Written by triggers,
// never by app code, so nothing can skip it. Holds ciphertext for encrypted fields, never plaintext.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityTable: text("entity_table").notNull(),
    entityId: uuid("entity_id"),
    transactionId: bigint("transaction_id", { mode: "number" }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (table) => [
    index("audit_log_transaction").on(table.transactionId),
    index("audit_log_entity").on(table.entityTable, table.entityId),
    pgPolicy("audit_log_select_admin", { for: "select", to: authenticatedRole, using: sql`(select public.is_admin())` }),
  ],
).enableRLS();

export type AuditEntry = typeof auditLog.$inferSelect;

// ── Leave ─────────────────────────────────────────────────────────────────────

export const leaveType = pgEnum("leave_type", LEAVE_TYPES);
export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "declined", "cancelled"]);
export const childOrder = pgEnum("child_order", ["first_or_second", "later"]);
export const settlementStatus = pgEnum("settlement_status", ["accepted", "changed", "waived"]);

export const holidayKind = pgEnum("holiday_kind", ["fixed", "lunar", "one_off"]);
export const holidayScope = pgEnum("holiday_scope", ["national", "thimphu"]);
export const holidayStatus = pgEnum("holiday_status", ["confirmed", "tentative"]);

// Government holidays: never counted as working-day leave. One dated record per holiday per year
// (a range for multi-day holidays), never a recurrence rule. Tentative dates count, and say so.
// Everyone reads them; admins add, change and remove them. Changes are audited and guarded (custom migration).
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    year: integer("year").notNull(),
    kind: holidayKind("kind").notNull(),
    scope: holidayScope("scope").notNull(),
    status: holidayStatus("status").notNull(),
    // Where the date comes from: the official list, a secondary source, or who declared it.
    source: text("source").notNull(),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("holidays_name_year").on(table.name, table.year),
    index("holidays_dates").on(table.startDate, table.endDate),
    check("holidays_end_after_start", sql`${table.endDate} >= ${table.startDate}`),
    check(
      "holidays_within_year",
      sql`extract(year from ${table.startDate}) = ${table.year} and extract(year from ${table.endDate}) = ${table.year}`,
    ),
    check("holidays_source_given", sql`length(trim(${table.source})) > 0`),
    pgPolicy("holidays_select_with_access", { for: "select", to: authenticatedRole, using: sql`(select public.has_access())` }),
    pgPolicy("holidays_insert_admin", { for: "insert", to: authenticatedRole, withCheck: sql`(select public.is_admin())` }),
    pgPolicy("holidays_update_admin", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select public.is_admin())`,
      withCheck: sql`(select public.is_admin())`,
    }),
    pgPolicy("holidays_delete_admin", { for: "delete", to: authenticatedRole, using: sql`(select public.is_admin())` }),
  ],
).enableRLS();

export type Holiday = typeof holidays.$inferSelect;

// A request for leave. Days and balances are never stored: they are counted from the dates, the
// working week and holidays. Dates, type and person never change after sending (trigger); people
// can't overlap their own pending or approved leave (exclusion constraint in a custom migration).
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    leaveType: leaveType("leave_type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // The first day is the afternoon only / the last day is the morning only.
    startHalf: boolean("start_half").notNull().default(false),
    endHalf: boolean("end_half").notNull().default(false),
    childOrder: childOrder("child_order"),
    eventDate: date("event_date"),
    note: text("note").notNull().default(""),
    status: leaveStatus("status").notNull().default("pending"),
    decisionNote: text("decision_note").notNull().default(""),
    requestedBy: uuid("requested_by").references(() => authUsers.id),
    decidedBy: uuid("decided_by").references(() => authUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // When the person last saw a decision on this request, for the in-app dot.
    ownerSeenAt: timestamp("owner_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("leave_requests_person_dates").on(table.personId, table.startDate),
    check("leave_requests_end_after_start", sql`${table.endDate} >= ${table.startDate}`),
    check(
      "leave_requests_one_half_on_a_single_day",
      sql`not (${table.startDate} = ${table.endDate} and ${table.startHalf} and ${table.endHalf})`,
    ),
    pgPolicy("leave_requests_select_own_or_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
    }),
    // People send their own requests as pending; admins can enter leave for anyone, approved on entry.
    pgPolicy("leave_requests_insert_own_pending_or_admin", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(${table.personId} = (select public.current_person_id()) and ${table.status} = 'pending' and ${table.requestedBy} = ${authUid})
        or (select public.is_admin())`,
    }),
    // What may change, and by whom, is enforced by a trigger.
    pgPolicy("leave_requests_update_own_or_admin", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
      withCheck: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
    }),
  ],
).enableRLS();

export type LeaveRequest = typeof leaveRequests.$inferSelect;

// The admin's decision on leave taken beyond the entitlement when someone leaves.
// Accepted or changed amounts become a recovery line in the final payroll run (milestone 4).
export const exitLeaveSettlements = pgTable(
  "exit_leave_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    leaveYear: integer("leave_year").notNull(),
    daysOver: numeric("days_over", { precision: 6, scale: 1, mode: "number" }).notNull(),
    dailyRateCh: bigint("daily_rate_ch", { mode: "number" }).notNull(),
    suggestedCh: bigint("suggested_ch", { mode: "number" }).notNull(),
    finalCh: bigint("final_ch", { mode: "number" }),
    unusedAnnualDays: numeric("unused_annual_days", { precision: 6, scale: 1, mode: "number" }).notNull(),
    status: settlementStatus("status").notNull(),
    decidedBy: uuid("decided_by").references(() => authUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("exit_leave_settlements_person_year").on(table.personId, table.leaveYear),
    check(
      "exit_leave_settlements_amount_matches_status",
      sql`(${table.status} = 'waived' and ${table.finalCh} is null) or (${table.status} <> 'waived' and ${table.finalCh} is not null and ${table.finalCh} >= 0)`,
    ),
    pgPolicy("exit_leave_settlements_admin", {
      for: "all",
      to: authenticatedRole,
      using: sql`(select public.is_admin())`,
      withCheck: sql`(select public.is_admin())`,
    }),
  ],
).enableRLS();

export type ExitLeaveSettlement = typeof exitLeaveSettlements.$inferSelect;

// In-app notes for a person, for example when a holiday change alters how their leave is counted.
// Written by admins' actions in the same transaction as the change; the person marks them seen.
export const leaveNotices = pgTable(
  "leave_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    leaveRequestId: uuid("leave_request_id").references(() => leaveRequests.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => [
    index("leave_notices_person").on(table.personId),
    pgPolicy("leave_notices_select_own_or_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
    }),
    pgPolicy("leave_notices_insert_admin", { for: "insert", to: authenticatedRole, withCheck: sql`(select public.is_admin())` }),
    // People only mark their own notes seen (column grant limits what can change).
    pgPolicy("leave_notices_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.personId} = (select public.current_person_id())`,
      withCheck: sql`${table.personId} = (select public.current_person_id())`,
    }),
  ],
).enableRLS();

export type LeaveNotice = typeof leaveNotices.$inferSelect;

// ── Payroll runs (milestone 4) ──────────────────────────────────────────────────
// A month is a draft until it is locked. Drafts store no figures: they are worked out on every read
// from the inputs. Locking writes a snapshot per person and freezes the month for good. Every change
// inside a locked month is refused by triggers (custom migration), even for the database owner.

export const payrollRunStatus = pgEnum("payroll_run_status", ["draft", "locked"]);
export const payrollLineKind = pgEnum("payroll_line_kind", LINE_KINDS);
export const payrollLineSource = pgEnum("payroll_line_source", LINE_SOURCES);

const adminOnly = (name: string) =>
  pgPolicy(name, { for: "all", to: authenticatedRole, using: sql`(select public.is_admin())`, withCheck: sql`(select public.is_admin())` });

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: date("month").notNull(),
    status: payrollRunStatus("status").notNull().default("draft"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => authUsers.id),
    // Totals as locked, so the run list and remittance never need the snapshots.
    peopleCount: integer("people_count"),
    grossCh: bigint("gross_ch", { mode: "number" }),
    healthContributionCh: bigint("health_contribution_ch", { mode: "number" }),
    providentFundCh: bigint("provident_fund_ch", { mode: "number" }),
    gisCh: bigint("gis_ch", { mode: "number" }),
    tdsCh: bigint("tds_ch", { mode: "number" }),
    recoveriesCh: bigint("recoveries_ch", { mode: "number" }),
    takeHomeCh: bigint("take_home_ch", { mode: "number" }),
    // TDS + HC, paid to DRC by the due date.
    remitCh: bigint("remit_ch", { mode: "number" }),
    dueDate: date("due_date"),
    ruleIds: text("rule_ids").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payroll_runs_month").on(table.month),
    check("payroll_runs_first_of_month", sql`extract(day from ${table.month}) = 1`),
    check(
      "payroll_runs_locked_complete",
      sql`${table.status} = 'draft' or (${table.lockedAt} is not null and ${table.peopleCount} is not null and ${table.grossCh} is not null
        and ${table.healthContributionCh} is not null and ${table.providentFundCh} is not null and ${table.gisCh} is not null
        and ${table.tdsCh} is not null and ${table.recoveriesCh} is not null and ${table.takeHomeCh} is not null
        and ${table.remitCh} is not null and ${table.dueDate} is not null and ${table.ruleIds} is not null)`,
    ),
    adminOnly("payroll_runs_admin"),
  ],
).enableRLS();

export type PayrollRun = typeof payrollRuns.$inferSelect;

// One-off lines on a person's pay for one month. Keyed by month rather than run, so a draft needs no row.
export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: date("month").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: payrollLineKind("kind").notNull(),
    amountCh: bigint("amount_ch", { mode: "number" }).notNull(),
    note: text("note").notNull().default(""),
    source: payrollLineSource("source").notNull().default("manual"),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payroll_lines_month").on(table.month),
    check("payroll_lines_first_of_month", sql`extract(day from ${table.month}) = 1`),
    check("payroll_lines_amount_positive", sql`${table.amountCh} > 0`),
    adminOnly("payroll_lines_admin"),
  ],
).enableRLS();

export type PayrollLine = typeof payrollLines.$inferSelect;

// A pre-lock check the admin has looked at and decided is fine.
export const payrollAcknowledgements = pgTable(
  "payroll_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: date("month").notNull(),
    checkKey: text("check_key").notNull(),
    note: text("note").notNull().default(""),
    acknowledgedBy: uuid("acknowledged_by").references(() => authUsers.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payroll_acknowledgements_month_check").on(table.month, table.checkKey),
    check("payroll_acknowledgements_first_of_month", sql`extract(day from ${table.month}) = 1`),
    adminOnly("payroll_acknowledgements_admin"),
  ],
).enableRLS();

// Everything a locked month used for one person, as it was: every input and figure, the rules
// version, and their name, type, TPN and bank details. Never updated or removed.
// TPN and bank account are the same ciphertext as on the person (bound to person and field), so they stay readable.
export const payrollSnapshots = pgTable(
  "payroll_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    employmentType: employmentType("employment_type").notNull(),
    // Phone, bank name, and TPN and bank account (ciphertext and last 4) as they were at lock.
    person: jsonb("person").notNull(),
    // Pay terms, dates, unpaid days, one-off lines and the exact payroll input.
    inputs: jsonb("inputs").notNull(),
    // The full payroll result.
    result: jsonb("result").notNull(),
    ruleIds: text("rule_ids").array().notNull(),
    grossCh: bigint("gross_ch", { mode: "number" }).notNull(),
    healthContributionCh: bigint("health_contribution_ch", { mode: "number" }).notNull(),
    providentFundCh: bigint("provident_fund_ch", { mode: "number" }).notNull(),
    gisCh: bigint("gis_ch", { mode: "number" }).notNull(),
    tdsCh: bigint("tds_ch", { mode: "number" }).notNull(),
    recoveriesCh: bigint("recoveries_ch", { mode: "number" }).notNull(),
    takeHomeCh: bigint("take_home_ch", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payroll_snapshots_run_person").on(table.runId, table.personId),
    // Milestone 5 adds a policy so people can read their own.
    adminOnly("payroll_snapshots_admin"),
  ],
).enableRLS();

export type PayrollSnapshot = typeof payrollSnapshots.$inferSelect;

// ── Payslips (milestone 5) ──────────────────────────────────────────────────────
// One per locked snapshot, built from it once and never changed. The PDF lives here, in Postgres, so
// the nightly backup carries it. People read their own (RLS); files are served through short-lived
// signed links after that check. Guards, audit and the email functions are in a custom migration.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => payrollSnapshots.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    month: date("month").notNull(),
    // XS-202610-007: the month, then the person's place in that month's payslips.
    reference: text("reference").notNull(),
    employmentType: employmentType("employment_type").notNull(),
    takeHomeCh: bigint("take_home_ch", { mode: "number" }).notNull(),
    // Exactly what the payslip says (modules/documents/model.ts), for the PDF and the in-app view.
    content: jsonb("content").notNull(),
    pdf: bytea("pdf").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    generatedBy: uuid("generated_by").references(() => authUsers.id),
  },
  (table) => [
    unique("payslips_snapshot").on(table.snapshotId),
    unique("payslips_reference").on(table.reference),
    index("payslips_person_month").on(table.personId, table.month),
    pgPolicy("payslips_select_own_or_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.personId} = (select public.current_person_id()) or (select public.is_admin())`,
    }),
    pgPolicy("payslips_insert_admin", { for: "insert", to: authenticatedRole, withCheck: sql`(select public.is_admin())` }),
  ],
).enableRLS();

export type Payslip = typeof payslips.$inferSelect;

export const emailKind = pgEnum("email_kind", ["payslip", "payslip_resend", "payslip_self", "leave_requested", "leave_decided"]);
export const emailStatus = pgEnum("email_status", ["queued", "sending", "sent", "failed", "skipped"]);

// Every email DashTeam sends, as a durable outbox: queued, claimed, then sent, failed or skipped.
// Written only through security-definer functions (custom migration), which check who's asking.
// The dedupe key makes the automatic emails happen once however many times issuing runs.
export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: emailKind("kind").notNull(),
    payslipId: uuid("payslip_id").references(() => payslips.id),
    leaveRequestId: uuid("leave_request_id").references(() => leaveRequests.id, { onDelete: "set null" }),
    toEmail: text("to_email").notNull(),
    dedupeKey: text("dedupe_key"),
    // What the email was about when it was queued, so a leave email is skipped if that changed.
    context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
    status: emailStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    // Plain words, shown to the admin. Never a raw provider error.
    lastError: text("last_error"),
    providerId: text("provider_id"),
    sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    requestedBy: uuid("requested_by").references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("email_deliveries_dedupe").on(table.dedupeKey),
    index("email_deliveries_payslip").on(table.payslipId),
    index("email_deliveries_status").on(table.status, table.sendAfter),
    pgPolicy("email_deliveries_select_admin_or_requester", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select public.is_admin()) or ${table.requestedBy} = ${authUid}`,
    }),
  ],
).enableRLS();

export type EmailDelivery = typeof emailDeliveries.$inferSelect;
