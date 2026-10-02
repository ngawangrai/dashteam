import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authUsers, authenticatedRole } from "drizzle-orm/supabase";

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
