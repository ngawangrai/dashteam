"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { formatDay, formatMonth } from "@/lib/format";

export type DateRange = { start: string | null; end: string | null };

type RangePickerProps = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  workingWeek: readonly number[];
  holidays: readonly string[];
  /** Holiday dates that aren't official yet, and each holiday date's names, for labels. */
  tentative?: readonly string[];
  labels?: Readonly<Record<string, readonly string[]>>;
  /** The month shown first, "YYYY-MM". */
  initialMonth: string;
  today: string;
};

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Tap the first day, then the last. Weekends and holidays stay tappable (leave can span them) but
 * are dimmed and labelled, because they aren't counted. Arrow keys move between days.
 */
export function RangePicker({ value, onChange, workingWeek, holidays, tentative = [], labels = {}, initialMonth, today }: RangePickerProps) {
  const [shown, setShown] = useState(initialMonth);
  const [focused, setFocused] = useState<string>(value.start ?? (today.startsWith(initialMonth) ? today : `${initialMonth}-01`));
  const grid = useRef<HTMLDivElement>(null);
  const holidaySet = new Set(holidays);
  const tentativeSet = new Set(tentative);

  const [year, month] = shown.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(year, month, i + 1)),
  ];

  function moveMonth(step: number) {
    const index = year * 12 + (month - 1) + step;
    setShown(`${Math.floor(index / 12)}-${pad((index % 12) + 1)}`);
  }

  function pick(date: string) {
    setFocused(date);
    if (!value.start || value.end) onChange({ start: date, end: null });
    else if (date < value.start) onChange({ start: date, end: null });
    else onChange({ start: value.start, end: date });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = shiftDate(focused, step);
    setFocused(next);
    if (!next.startsWith(shown)) setShown(next.slice(0, 7));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus());
  }

  const end = value.end ?? value.start;
  const inRange = (date: string) => value.start !== null && end !== null && date >= value.start && date <= end;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-body font-semibold" aria-live="polite">
          {formatMonth({ year, month }, { withYear: true })}
        </span>
        <div className="flex">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month" className="pressable flex size-11 items-center justify-center text-accent">
            <Icon icon={ChevronLeft} size={22} />
          </button>
          <button type="button" onClick={() => moveMonth(1)} aria-label="Next month" className="pressable flex size-11 items-center justify-center text-accent">
            <Icon icon={ChevronRight} size={22} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-caption text-label-secondary" aria-hidden="true">
        {WEEKDAY_LETTERS.map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
      </div>
      <div ref={grid} role="group" aria-label="Choose the first and last day" className="grid grid-cols-7 gap-y-1" onKeyDown={onKeyDown}>
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />;
          const weekday = ((new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay() + 6) % 7) + 1;
          const offDay = !workingWeek.includes(weekday);
          const holiday = holidaySet.has(date);
          const selected = inRange(date);
          const edge = date === value.start || date === end;
          const tentativeHoliday = tentativeSet.has(date);
          const names = labels[date]?.join(", ");
          const label = `${formatDay(date, { long: true })}${
            holiday ? `, ${names ? `${names}, ` : ""}${tentativeHoliday && !names ? "tentative " : ""}holiday, not counted` : offDay ? ", not a working day" : ""
          }`;
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              tabIndex={date === focused ? 0 : -1}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => pick(date)}
              className={[
                "relative flex h-11 items-center justify-center text-body tabular transition-colors duration-150",
                selected && !edge ? "bg-accent/15" : "",
                edge ? "rounded-control bg-accent-fill font-semibold text-on-accent" : "",
                !edge && (offDay || holiday) ? "text-label-secondary" : "",
                date === today && !edge ? "font-semibold text-accent" : "",
              ].join(" ")}
            >
              {Number(date.slice(8))}
              {holiday ? (
                // A filled dot for a confirmed holiday, an outline for a tentative one.
                <span
                  aria-hidden="true"
                  className={`absolute bottom-1 size-1.5 rounded-full ${
                    tentativeHoliday ? `border ${edge ? "border-on-accent" : "border-warning"}` : edge ? "bg-on-accent" : "bg-warning"
                  }`}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
