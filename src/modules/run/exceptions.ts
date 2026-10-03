import { firstOfMonth, formatDate, formatDays, monthBounds } from "@/lib/format";
import { BASIS_POINTS_PER_WHOLE, type PayrollMonth } from "@/modules/rules/types";
import type { PersonRun, RunPerson } from "./build";

// What makes a person's pay this month worth a second look on the review screen. Each one is shown
// as words beside an icon, never as colour alone.

export type ExceptionKind = "new_joiner" | "leaver" | "unpaid_leave" | "one_offs" | "pay_change" | "large_change";
export type RunException = { kind: ExceptionKind; label: string };

const dayAndMonth = (date: string) => formatDate(date).replace(/ \d{4}$/, "");

export function exceptionsFor(run: PersonRun, person: RunPerson, month: PayrollMonth, largeChange: number): RunException[] {
  const { from, to } = monthBounds(month);
  const exceptions: RunException[] = [];

  if (person.startDate >= from && person.startDate <= to) {
    exceptions.push({ kind: "new_joiner", label: `Joined ${dayAndMonth(person.startDate)}` });
  }
  if (person.endDate && person.endDate >= from && person.endDate <= to) {
    exceptions.push({ kind: "leaver", label: `Last day ${dayAndMonth(person.endDate)}` });
  }
  if (run.unpaidLeaveDays > 0) {
    exceptions.push({ kind: "unpaid_leave", label: `${formatDays(run.unpaidLeaveDays)} unpaid` });
  }
  if (run.lines.length) {
    exceptions.push({ kind: "one_offs", label: run.lines.length === 1 ? "1 one-off" : `${run.lines.length} one-offs` });
  }

  // A record from this month that isn't their first: a raise, a cut or a change of type.
  const start = firstOfMonth(month);
  if (person.pay.some((record) => record.effectiveFrom === start) && person.pay.some((record) => record.effectiveFrom < start)) {
    exceptions.push({ kind: "pay_change", label: "New pay" });
  }

  // Integers only: |change| × 10,000 against the threshold × last month's take-home.
  const previous = run.previousTakeHome;
  if (run.result && previous !== null && previous > 0) {
    const change = run.result.takeHome - previous;
    if (Math.abs(change) * BASIS_POINTS_PER_WHOLE >= largeChange * previous) {
      const percent = Math.round((Math.abs(change) * 100) / previous);
      exceptions.push({ kind: "large_change", label: `Take-home ${change > 0 ? "up" : "down"} ${percent}%` });
    }
  }
  return exceptions;
}
