import { resolveLeaveRules } from "@/modules/rules/resolve";
import type { EmploymentType, LeaveType, RuleRow } from "@/modules/rules/types";
import type { LeaveRequestFacts } from "./balance";
import { countLeaveDays } from "./days";

// Holidays are dated records, one per year, never a recurrence rule. Fixed-date holidays can be
// copied forward; lunar and one-off holidays are entered each year. Pure functions only.

export type HolidayKind = "fixed" | "lunar" | "one_off";
export type HolidayScope = "national" | "thimphu";
export type HolidayStatus = "confirmed" | "tentative";

export type Holiday = {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  year: number;
  kind: HolidayKind;
  scope: HolidayScope;
  status: HolidayStatus;
  source: string;
  note: string;
};

const DAY_MS = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function datesOf(holiday: Pick<Holiday, "startDate" | "endDate">): string[] {
  const dates: string[] = [];
  for (let date = holiday.startDate; date <= holiday.endDate; date = shift(date, 1)) dates.push(date);
  return dates;
}

/** Every date covered by any holiday, once each, in order: what leave counting skips. */
export function expandHolidays(holidays: readonly Pick<Holiday, "startDate" | "endDate">[]): string[] {
  return [...new Set(holidays.flatMap(datesOf))].sort();
}

/** Dates covered only by tentative holidays, so the screens can say "tentative" next to them. */
export function tentativeDates(holidays: readonly Holiday[]): string[] {
  const confirmed = new Set(expandHolidays(holidays.filter((h) => h.status === "confirmed")));
  return expandHolidays(holidays.filter((h) => h.status === "tentative")).filter((date) => !confirmed.has(date));
}

export function holidaysByDate(holidays: readonly Holiday[]): Record<string, Holiday[]> {
  const byDate: Record<string, Holiday[]> = {};
  for (const holiday of holidays) for (const date of datesOf(holiday)) (byDate[date] ??= []).push(holiday);
  return byDate;
}

/** A holiday's name, saying so when the date isn't confirmed yet. */
export function holidayLabel(holiday: Pick<Holiday, "name" | "status">): string {
  return holiday.status === "tentative" ? `${holiday.name} (tentative)` : holiday.name;
}

// ── What a change does to leave ─────────────────────────────────────────────────

export type ImpactRequest = LeaveRequestFacts & { personId: string; personName: string; employmentType: EmploymentType | null };

export type ImpactChange = {
  requestId: string;
  personId: string;
  personName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  before: number;
  after: number;
};

function countFor(request: ImpactRequest, ruleRows: readonly RuleRow[]): "working" | "calendar" {
  if (!request.employmentType) return "working";
  try {
    const [year, month] = request.startDate.split("-").map(Number);
    return resolveLeaveRules(ruleRows, request.employmentType, { year: year ?? 0, month: month ?? 1 }).policy[request.leaveType]?.count ?? "working";
  } catch {
    return "working";
  }
}

/**
 * The pending and approved requests whose day count changes when the holidays go from `before`
 * to `after`, with both counts. Shown to the admin before the change is saved.
 */
export function holidayImpact(input: {
  requests: readonly ImpactRequest[];
  ruleRows: readonly RuleRow[];
  workingWeek: readonly number[];
  before: readonly Holiday[];
  after: readonly Holiday[];
}): ImpactChange[] {
  const beforeCalendar = { workingWeek: input.workingWeek, holidays: expandHolidays(input.before) };
  const afterCalendar = { workingWeek: input.workingWeek, holidays: expandHolidays(input.after) };
  return input.requests
    .filter((request) => request.status === "pending" || request.status === "approved")
    .flatMap((request) => {
      const count = countFor(request, input.ruleRows);
      const before = countLeaveDays(request, beforeCalendar, count).total;
      const after = countLeaveDays(request, afterCalendar, count).total;
      if (before === after) return [];
      return [
        {
          requestId: request.id,
          personId: request.personId,
          personName: request.personName,
          leaveType: request.leaveType,
          startDate: request.startDate,
          endDate: request.endDate,
          before,
          after,
        },
      ];
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.personName.localeCompare(b.personName));
}

/** A short fingerprint of an impact, so saving can tell whether anything changed since the preview. */
export function impactFingerprint(changes: readonly ImpactChange[]): string {
  return changes.map((c) => `${c.requestId}:${c.before}>${c.after}`).join("|");
}

// ── Copying forward and reminding ───────────────────────────────────────────────

/**
 * Fixed-date holidays from one year, copied to the same month and day in another. Copies are
 * tentative until the official list confirms them. Lunar and one-off holidays are never copied.
 */
export function copyFixedHolidays(
  holidays: readonly Holiday[],
  fromYear: number,
  toYear: number,
): { copies: Holiday[]; skipped: { name: string; reason: string }[] } {
  const existing = new Set(holidays.filter((h) => h.year === toYear).map((h) => h.name));
  const copies: Holiday[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const holiday of holidays.filter((h) => h.year === fromYear && h.kind === "fixed").sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    if (existing.has(holiday.name)) {
      skipped.push({ name: holiday.name, reason: `Already in ${toYear}.` });
      continue;
    }
    const move = (date: string) => `${toYear}${date.slice(4)}`;
    const startDate = move(holiday.startDate);
    const endDate = move(holiday.endDate);
    const exists = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`)).toISOString().slice(0, 10) === date;
    if (!exists(startDate) || !exists(endDate)) {
      skipped.push({ name: holiday.name, reason: `29 February isn’t in ${toYear}.` });
      continue;
    }
    copies.push({
      name: holiday.name,
      startDate,
      endDate,
      year: toYear,
      kind: "fixed",
      scope: holiday.scope,
      status: "tentative",
      source: `Copied from ${fromYear}. Confirm when the official list is published.`,
      note: "",
    });
  }
  return { copies, skipped };
}

/** From 1 November, remind the admin while next year has no confirmed holidays. */
export function needsHolidayReminder(today: string, nextYearConfirmed: number): boolean {
  return today.slice(5) >= "11-01" && nextYearConfirmed === 0;
}
