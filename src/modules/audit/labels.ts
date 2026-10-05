import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";

// Audit entries are written by database triggers. The app only names the action, so the log
// reads "person.exited" rather than "people.update". The label lasts until the transaction ends.

export type AuditAction =
  | "person.created"
  | "person.updated"
  | "person.exited"
  | "pay.set"
  | "pay.changed"
  | "profile_change.requested"
  | "profile_change.withdrawn"
  | "profile_change.approved"
  | "profile_change.declined"
  | "leave.requested"
  | "leave.entered"
  | "leave.approved"
  | "leave.declined"
  | "leave.cancelled"
  | "holiday.added"
  | "holiday.moved"
  | "holiday.updated"
  | "holiday.confirmed"
  | "holiday.copied"
  | "holiday.removed"
  | "exit_leave.accepted"
  | "exit_leave.changed"
  | "exit_leave.waived"
  | "payroll.first_month_set"
  | "payroll.line_added"
  | "payroll.line_removed"
  | "payroll.acknowledged"
  | "payroll.locked"
  | "payslip.generated";

export async function labelNextWrites(tx: Tx, action: AuditAction): Promise<void> {
  await tx.execute(sql`select set_config('dashteam.action', ${action}, true)`);
}

/** The transaction id that ties this change's audit entries together, used to undo it. */
export async function currentTransactionId(tx: Tx): Promise<number> {
  const rows = await tx.execute<{ id: string }>(sql`select txid_current()::text as id`);
  return Number(rows[0]?.id);
}
