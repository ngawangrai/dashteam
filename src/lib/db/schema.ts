import { sql } from "drizzle-orm";
import { check, date, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
