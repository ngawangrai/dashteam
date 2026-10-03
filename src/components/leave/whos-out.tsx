import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { addMonths, formatDay, formatMonth, formatSpan } from "@/lib/format";
import { type Holiday, holidayLabel, holidaysByDate } from "@/modules/leave/holidays";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import type { OutEntry } from "@/modules/leave/repository";

type WhosOutProps = {
  month: { year: number; month: number };
  entries: OutEntry[];
  today: string;
  workingWeek: readonly number[];
  holidays: readonly Holiday[];
  /** Base path for moving between months, e.g. "/leave" or "/admin/calendar". */
  path: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const key = (m: { year: number; month: number }) => `${m.year}-${pad(m.month)}`;

function describe(entry: OutEntry, day: string): string {
  if (entry.startDate === entry.endDate) {
    if (entry.startHalf) return "afternoon";
    if (entry.endHalf) return "morning";
    return "all day";
  }
  if (day === entry.startDate) return `until ${formatDay(entry.endDate)}`;
  return formatSpan(entry.startDate, entry.endDate);
}

/**
 * Who's out, as a list of days in a month: easy to read on a phone and with a screen reader.
 * Each person appears on the first working day of their leave in this month.
 */
export function WhosOut({ month, entries, today, workingWeek, holidays, path }: WhosOutProps) {
  const prefix = key(month);
  const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  // Multi-day holidays appear on each of their working days; tentative ones say so.
  const byDate = holidaysByDate(holidays);
  const holidayNames = new Map(Object.entries(byDate).map(([date, list]) => [date, list.map(holidayLabel).join(", ")]));

  const isWorkingDay = (day: string) => workingWeek.includes(((new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay() + 6) % 7) + 1);
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => `${prefix}-${pad(i + 1)}`);

  // Each person appears once, on the first working day of their leave within this month.
  const byDay = new Map<string, OutEntry[]>();
  for (const entry of entries) {
    const shownOn = monthDays.find((day) => day >= entry.startDate && day <= entry.endDate && isWorkingDay(day));
    if (shownOn) byDay.set(shownOn, [...(byDay.get(shownOn) ?? []), entry]);
  }
  const days = monthDays
    .filter((day) => byDay.has(day) || (holidayNames.has(day) && isWorkingDay(day)))
    .map((day) => ({ day, starting: byDay.get(day) ?? [], holiday: holidayNames.get(day) }));

  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="whos-out">
      <div className="flex items-center justify-between px-4">
        <h2 id="whos-out" className="text-caption uppercase text-label-secondary">
          Who’s out · {formatMonth(month, { withYear: true })}
        </h2>
        <div className="-mr-3 flex">
          <Link href={`${path}?month=${key(previous)}` as Route} aria-label={`${formatMonth(previous, { withYear: true })}`} className="flex size-11 items-center justify-center text-accent">
            <Icon icon={ChevronLeft} size={20} />
          </Link>
          <Link href={`${path}?month=${key(next)}` as Route} aria-label={`${formatMonth(next, { withYear: true })}`} className="flex size-11 items-center justify-center text-accent">
            <Icon icon={ChevronRight} size={20} />
          </Link>
        </div>
      </div>
      <div className="rounded-card bg-surface">
        {days.length ? (
          days.map(({ day, starting, holiday }) => (
            <div key={day} className="border-b border-separator/60 px-4 py-3 last:border-b-0">
              <h3 className="text-secondary font-semibold text-label-secondary">
                {day === today ? "Today · " : ""}
                {formatDay(day)}
                {holiday ? ` · ${holiday}` : ""}
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {starting.map((entry) => (
                  <li key={`${entry.personId}-${entry.startDate}`} className="flex items-baseline justify-between gap-3 text-body">
                    <span className="min-w-0 truncate">
                      {entry.fullName}
                      {entry.leaveType ? <span className="text-label-secondary"> · {LEAVE_TYPE_NAME[entry.leaveType]}</span> : null}
                      {entry.pending ? <span className="text-warning"> · waiting</span> : null}
                    </span>
                    <span className="shrink-0 text-secondary text-label-secondary tabular">{describe(entry, day)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="px-4 py-3 text-body text-label-secondary">No one is out this month.</p>
        )}
      </div>
    </section>
  );
}
