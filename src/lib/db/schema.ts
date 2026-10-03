import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
