import type { PayrollMonth, PlainDate } from "@/modules/rules/types";

type DateParts = { year: number; month: number; day: number };

/** Day 0 of the next month is the last day of this one. */
export function daysInMonth({ year, month }: PayrollMonth): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parsePlainDate(date: PlainDate): DateParts {
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) throw new Error(`Not a date: ${date}`);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Not a date: ${date}`);
  }
  return { year, month, day };
}

function compareMonth(date: DateParts, month: PayrollMonth): number {
  return date.year === month.year ? date.month - month.month : date.year - month.year;
}

/**
 * Calendar days the person is employed in the month. The joining day and the last
 * working day both count. Zero when the employment does not touch the month.
 */
export function daysEmployedInMonth(month: PayrollMonth, joinedOn?: PlainDate, lastWorkingDay?: PlainDate): number {
  const lastDay = daysInMonth(month);
  let first = 1;
  let last = lastDay;

  if (joinedOn) {
    const joined = parsePlainDate(joinedOn);
    const order = compareMonth(joined, month);
    if (order > 0) return 0;
    if (order === 0) first = joined.day;
  }
  if (lastWorkingDay) {
    const left = parsePlainDate(lastWorkingDay);
    const order = compareMonth(left, month);
    if (order < 0) return 0;
    if (order === 0) last = left.day;
  }
  return Math.max(0, last - first + 1);
}
