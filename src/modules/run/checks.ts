import { firstNameFrom } from "@/lib/auth/roles";
import { addMonths, formatMonth, formatSpan, monthBounds } from "@/lib/format";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import type { PayrollMonth } from "@/modules/rules/types";
import { type PersonRun, type RunInput, type RunPerson, monthIndex } from "./build";

// What to look at before locking. Some things must be cleared first (an earlier month still open,
// someone with no pay); the rest can be acknowledged, so a month is never held up by something
// the admin has decided is fine.

export type RunCheck = {
  /** Stable, so an acknowledgement stays attached to the same thing. */
  key: string;
  kind: "must_clear" | "acknowledge";
  title: string;
  /** What it means and what to do. */
  detail: string;
  personId: string | null;
  acknowledged: boolean;
};

type Draft = Omit<RunCheck, "kind" | "acknowledged">;

const monthKey = ({ year, month }: PayrollMonth) => `${year}-${String(month).padStart(2, "0")}`;

const CHANGE_WORDS: Record<"phone" | "bank", string> = { phone: "phone number", bank: "bank details" };

export function checksFor(input: RunInput, employed: RunPerson[], people: PersonRun[]): RunCheck[] {
  const { month } = input;
  const name = formatMonth(month);
  const { from, to } = monthBounds(month);
  const acknowledged = new Set(input.acknowledged);
  const mustClear: Draft[] = [];
  // Grouped by kind, in this order, so the list reads as a few clear groups.
  const pendingLeave: Draft[] = [];
  const pendingChanges: Draft[] = [];
  const missingTpn: Draft[] = [];
  const missingBank: Draft[] = [];
  const tentative: Draft[] = [];

  // ── The month itself ──
  if (!input.firstMonth) {
    mustClear.push({ key: "no_first_month", title: "Choose the first month DashTeam pays", detail: "Set it on the Payroll screen.", personId: null });
  } else if (monthIndex(month) < monthIndex(input.firstMonth)) {
    mustClear.push({
      key: "before_first_month",
      title: `DashTeam pays from ${formatMonth(input.firstMonth, { withYear: true })}`,
      detail: `${name} is paid outside DashTeam.`,
      personId: null,
    });
  } else {
    const locked = new Set(input.lockedMonths.map(monthKey));
    for (let m = input.firstMonth; monthIndex(m) < monthIndex(month); m = addMonths(m, 1)) {
      if (locked.has(monthKey(m))) continue;
      mustClear.push({
        key: `earlier_month:${monthKey(m)}`,
        title: `${formatMonth(m)} payroll isn’t locked yet`,
        detail: `Months lock in order. Lock ${formatMonth(m)} first, then come back to ${name}.`,
        personId: null,
      });
      break;
    }
  }

  if (input.today && input.today < from) {
    mustClear.push({ key: "not_started", title: `${name} hasn’t started yet`, detail: `You can lock it from 1 ${name}.`, personId: null });
  }

  // ── Each person ──
  for (const run of people) {
    const first = run.firstName;
    if (!run.terms) {
      mustClear.push({ key: `no_pay:${run.personId}`, title: `${first} has no pay for ${name}`, detail: "Add their pay on their page, then come back.", personId: run.personId });
    } else if (run.problem) {
      mustClear.push({ key: `problem:${run.personId}`, title: `${first}’s pay can’t be worked out`, detail: run.problem, personId: run.personId });
    } else if (run.result && run.result.takeHome < 0) {
      mustClear.push({
        key: `negative:${run.personId}`,
        title: `${first}’s take-home is below zero`,
        detail: "Lower or remove a deduction, and recover the rest next month.",
        personId: run.personId,
      });
    }
  }

  for (const person of employed) {
    const first = firstNameFrom(person.fullName, "");
    for (const request of person.leave) {
      if (request.status !== "pending" || request.startDate > to || request.endDate < from) continue;
      pendingLeave.push({
        key: `pending_leave:${request.id}`,
        title: `${first}’s ${LEAVE_TYPE_NAME[request.leaveType].toLowerCase()} on ${formatSpan(request.startDate, request.endDate)} is waiting for a decision`,
        detail: `Decide it on Home first. If you lock now, ${name} is paid as if it isn’t taken.`,
        personId: person.id,
      });
    }
    if (person.pendingChange) {
      const fields = person.pendingChange.fields.map((field) => CHANGE_WORDS[field]).join(" and ");
      pendingChanges.push({
        key: `pending_change:${person.pendingChange.id}`,
        title: `${first} asked to change their ${fields}`,
        detail: `Approve or decline it on Home first. If you lock now, ${name} uses the details on file.`,
        personId: person.id,
      });
    }
    if (!person.hasTpn) {
      missingTpn.push({ key: `missing_tpn:${person.id}`, title: `${first} has no TPN on file`, detail: "Add it on their page. The IT-1(a) needs it.", personId: person.id });
    }
    if (!person.hasBankAccount) {
      missingBank.push({
        key: `missing_bank:${person.id}`,
        title: `${first} has no bank account on file`,
        detail: "Add it on their page, or pay them another way. Their row on the bank list will have no account number.",
        personId: person.id,
      });
    }
  }

  for (const holiday of input.holidays) {
    if (holiday.status !== "tentative" || holiday.startDate > to || holiday.endDate < from) continue;
    tentative.push({
      key: `tentative_holiday:${holiday.startDate}:${holiday.name}`,
      title: `${holiday.name} on ${formatSpan(holiday.startDate, holiday.endDate)} is tentative`,
      detail: `It counts as a holiday in ${name}’s leave. If the date moves after locking, ${name} stays as it is.`,
      personId: null,
    });
  }
  tentative.sort((a, b) => a.key.localeCompare(b.key));

  return [
    ...mustClear.map((check) => ({ ...check, kind: "must_clear" as const, acknowledged: false })),
    ...[...pendingLeave, ...pendingChanges, ...missingTpn, ...missingBank, ...tentative].map((check) => ({ ...check, kind: "acknowledge" as const, acknowledged: acknowledged.has(check.key) })),
  ];
}
