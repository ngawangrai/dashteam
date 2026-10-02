import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  jsonb,
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
import { EMPLOYMENT_TYPES, RULE_KEYS } from "@/modules/rules/types";

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
