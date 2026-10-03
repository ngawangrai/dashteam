import { formatMonth } from "@/lib/format";
import type { PayrollMonth } from "@/modules/rules/types";

// The database refuses any change inside a locked month and names the month in a token:
// "[payroll_locked:2026-10:2026-11]" (the locked month, then the first month still open).
// The app turns that into words that say what to do instead.

const TOKEN = /payroll_locked:(\d{4})-(\d{2}):(\d{4})-(\d{2})/;

export type LockedMonths = { locked: PayrollMonth; draft: PayrollMonth };

export function lockedMonthsIn(error: unknown): LockedMonths | null {
  const text = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : String(error.cause ?? "")}` : String(error);
  const match = TOKEN.exec(text);
  if (!match) return null;
  return {
    locked: { year: Number(match[1]), month: Number(match[2]) },
    draft: { year: Number(match[3]), month: Number(match[4]) },
  };
}

export function lockedMessage(months: LockedMonths | null, audience: "admin" | "employee"): string {
  if (!months) return audience === "admin" ? "That month’s payroll is locked, so this can’t change." : "That month’s payroll is locked. Ask your admin to add a correction.";
  if (audience === "employee") return `${formatMonth(months.locked)} payroll is locked. Ask your admin to add a correction.`;
  return `${formatMonth(months.locked, { withYear: true })} payroll is locked, so this can’t change. Add a correction to ${formatMonth(months.draft)}’s payroll instead.`;
}
