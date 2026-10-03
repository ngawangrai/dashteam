import type { PlainDate } from "@/modules/rules/types";

// Counting leave days. Pure: dates, the working week and holidays in, days out.

export type LeaveSpan = {
  startDate: PlainDate | string;
  endDate: PlainDate | string;
  /** The first day is taken in the afternoon only. */
  startHalf: boolean;
  /** The last day is taken in the morning only. */
  endHalf: boolean;
};

export type LeaveCalendar = {
  workingWeek: readonly number[];
  /** Every holiday date, confirmed or tentative: none of them is counted as working-day leave. */
  holidays: readonly string[];
  /** For display only: dates that are holidays only tentatively, and each holiday date's labels. */
  tentative?: readonly string[];
  labels?: Readonly<Record<string, readonly string[]>>;
};

export type CountedDay = { date: string; days: number; reason?: "weekend" | "holiday" };

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const time = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  if (new Date(time).toISOString().slice(0, 10) !== date) throw new Error(`Not a date: ${date}`);
  return time;
}

const isoWeekday = (time: number) => {
  const day = new Date(time).getUTCDay();
  return day === 0 ? 7 : day;
};

/**
 * Every date in the span with what it counts for: 1, ½ or 0. Working-day leave skips days outside
 * the working week and holidays; calendar-day leave (maternity) counts every day.
 */
export function countLeaveDays(span: LeaveSpan, calendar: LeaveCalendar, count: "working" | "calendar"): { total: number; byDate: CountedDay[] } {
  const start = toUtc(span.startDate);
  const end = toUtc(span.endDate);
  if (end < start) throw new Error("Leave can’t end before it starts.");
  if (start === end && span.startHalf && span.endHalf) throw new Error("A single day can be a morning or an afternoon, not both.");

  const holidays = new Set(calendar.holidays);
  const byDate: CountedDay[] = [];
  for (let time = start; time <= end; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (count === "working" && !calendar.workingWeek.includes(isoWeekday(time))) {
      byDate.push({ date, days: 0, reason: "weekend" });
      continue;
    }
    if (count === "working" && holidays.has(date)) {
      byDate.push({ date, days: 0, reason: "holiday" });
      continue;
    }
    const half = (time === start && span.startHalf) || (time === end && span.endHalf);
    byDate.push({ date, days: half ? 0.5 : 1 });
  }
  return { total: byDate.reduce((sum, day) => sum + day.days, 0), byDate };
}

/** Days per calendar month, keyed "YYYY-MM". */
export function daysByMonth(byDate: readonly CountedDay[]): Record<string, number> {
  const months: Record<string, number> = {};
  for (const day of byDate) {
    if (!day.days) continue;
    const key = day.date.slice(0, 7);
    months[key] = (months[key] ?? 0) + day.days;
  }
  return months;
}

/** Days falling in one leave year (the calendar year). */
export function daysInYear(byDate: readonly CountedDay[], year: number): number {
  const prefix = `${year}-`;
  return byDate.filter((day) => day.date.startsWith(prefix)).reduce((sum, day) => sum + day.days, 0);
}
