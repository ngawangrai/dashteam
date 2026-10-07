import { addMonths, firstOfMonth } from "@/lib/format";
import type { PayrollMonth, PlainDate } from "@/modules/rules/types";

// When TDS is due and how far away that is. Everything here works on calendar dates already in
// Asia/Thimphu (see thimphuToday in lib/format), so a month end, a leap year or the hours between
// Thimphu and UTC can never move a deadline by a day.

const DAY_MS = 86_400_000;
/** From this many days out, the deadline reads as soon. */
const SOON_DAYS = 3;

/** TDS for a month is due on this day of the next. */
export function dueDateFor(month: PayrollMonth, dueDay: number): PlainDate {
  return `${firstOfMonth(addMonths(month, 1)).slice(0, 8)}${String(dueDay).padStart(2, "0")}` as PlainDate;
}

/** Whole calendar days from one date to another: negative once it has passed. */
export function daysUntil(today: string, due: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export type DueStatus = { kind: "upcoming"; days: number; soon: boolean } | { kind: "today" } | { kind: "overdue"; days: number };

export function dueStatus(today: string, due: string): DueStatus {
  const days = daysUntil(today, due);
  if (days > 0) return { kind: "upcoming", days, soon: days <= SOON_DAYS };
  if (days === 0) return { kind: "today" };
  return { kind: "overdue", days: -days };
}

const index = ({ year, month }: PayrollMonth) => year * 12 + month - 1;

/** Months that need filing now: from DashTeam's first month to last month, less those already filed. */
export function monthsToFile(today: string, firstMonth: PayrollMonth | null, filed: readonly PayrollMonth[]): PayrollMonth[] {
  if (!firstMonth) return [];
  const [year, month] = today.split("-").map(Number);
  const lastMonth = addMonths({ year: year ?? 0, month: month ?? 1 }, -1);
  const done = new Set(filed.map(index));
  const months: PayrollMonth[] = [];
  for (let m = firstMonth; index(m) <= index(lastMonth); m = addMonths(m, 1)) if (!done.has(index(m))) months.push(m);
  return months;
}

/** What today's reminder covers: the months still to file, if today is one of the reminder days. */
export function remindersToday<T>(today: string, reminderDays: readonly number[], unfiled: readonly T[]): T[] {
  return reminderDays.includes(Number(today.slice(8, 10))) ? [...unfiled] : [];
}
