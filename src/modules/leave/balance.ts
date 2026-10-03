import { resolveLeaveRules } from "@/modules/rules/resolve";
import type { ChildOrder, EmploymentType, LeaveAllowance, LeaveType, RuleRow } from "@/modules/rules/types";
import { type LeaveCalendar, type LeaveSpan, countLeaveDays, daysInYear } from "./days";

// Balances are never stored: they are worked out from the rules in force on 1 January of the leave
// year, the months employed in that year, and the person's approved and pending requests.

export type LeaveStatus = "pending" | "approved" | "declined" | "cancelled";

export type LeaveRequestFacts = LeaveSpan & {
  id: string;
  leaveType: LeaveType;
  status: LeaveStatus;
  childOrder: ChildOrder | null;
};

export type Employment = { startDate: string; endDate: string | null };

export type Balance =
  | { kind: "pool"; entitlement: number; used: number; pending: number; left: number; count: "working" | "calendar" }
  | { kind: "perEvent"; allowance: number; count: "working" | "calendar" }
  | { kind: "noLimit"; used: number; pending: number; count: "working" | "calendar" }
  | { kind: "notOffered" };

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Whole months employed in a leave year. The joining month counts if they start on or before the
 * cut-off day; the leaving month counts if their last working day is on or after it.
 */
export function monthsEmployedInYear(year: number, employment: Employment, cutoffDay: number): number {
  let months = 0;
  for (let month = 1; month <= 12; month += 1) {
    const first = `${year}-${pad(month)}-01`;
    const last = `${year}-${pad(month)}-${pad(lastDayOf(year, month))}`;
    if (employment.startDate > last) continue;
    if (employment.endDate !== null && employment.endDate < first) continue;
    const joinsThisMonth = employment.startDate >= first;
    const leavesThisMonth = employment.endDate !== null && employment.endDate <= last;
    if (joinsThisMonth && Number(employment.startDate.slice(8)) > cutoffDay) continue;
    if (leavesThisMonth && Number(employment.endDate?.slice(8)) < cutoffDay) continue;
    months += 1;
  }
  return months;
}

/** A yearly allowance for the months employed, rounded to the nearest half day (half up). */
export function entitlementFor(allowance: Extract<LeaveAllowance, { kind: "perYear" }>, months: number): number {
  if (!allowance.prorate) return allowance.days;
  // In half days, with integers only: round(days × 2 × months ÷ 12), halves rounding up.
  const halfDays = Math.round(allowance.days * 2);
  return Math.floor((halfDays * months * 2 + 12) / 24) / 2;
}

type BalanceInput = {
  leaveType: LeaveType;
  year: number;
  employmentType: EmploymentType;
  person: Employment;
  requests: readonly LeaveRequestFacts[];
  ruleRows: readonly RuleRow[];
  calendar: LeaveCalendar;
  childOrder?: ChildOrder | null;
};

function usedAndPending(input: BalanceInput, count: "working" | "calendar") {
  let used = 0;
  let pending = 0;
  for (const request of input.requests) {
    if (request.leaveType !== input.leaveType) continue;
    if (request.status !== "approved" && request.status !== "pending") continue;
    const days = daysInYear(countLeaveDays(request, input.calendar, count).byDate, input.year);
    if (request.status === "approved") used += days;
    else pending += days;
  }
  return { used, pending };
}

export function balanceFor(input: BalanceInput): Balance {
  const rules = resolveLeaveRules(input.ruleRows, input.employmentType, { year: input.year, month: 1 });
  const policy = rules.policy[input.leaveType];
  if (!policy) return { kind: "notOffered" };
  const { allowance, count } = policy;

  switch (allowance.kind) {
    case "perYear": {
      const months = monthsEmployedInYear(input.year, input.person, rules.prorationCutoffDay);
      const entitlement = entitlementFor(allowance, months);
      // Carry-forward is a rule; it is 0 for every type in V1.
      const { used, pending } = usedAndPending(input, count);
      return { kind: "pool", entitlement, used, pending, left: entitlement - used - pending, count };
    }
    case "perEvent": {
      const later = input.childOrder === "later" && allowance.laterChildDays !== null;
      return { kind: "perEvent", allowance: later ? (allowance.laterChildDays ?? allowance.days) : allowance.days, count };
    }
    default: {
      const { used, pending } = usedAndPending(input, count);
      return { kind: "noLimit", used, pending, count };
    }
  }
}

// ── Checking a new request ───────────────────────────────────────────────────────

export type NewRequest = LeaveSpan & { leaveType: LeaveType; childOrder: ChildOrder | null; eventDate: string | null };

export type Assessment =
  | { ok: true; days: number; leftAfter: number | null; allowance: number | null; count: "working" | "calendar" }
  | { ok: false; reason: string; days?: number };

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Whether a new request fits the rules and the balance. Used live while picking dates, and again on the server. */
export function assessRequest(
  request: NewRequest,
  context: Omit<BalanceInput, "leaveType" | "year" | "childOrder">,
): Assessment {
  const rules = resolveLeaveRules(context.ruleRows, context.employmentType, { year: Number(request.startDate.slice(0, 4)), month: 1 });
  const policy = rules.policy[request.leaveType];
  if (!policy) return { ok: false, reason: "This kind of leave isn’t available to you." };
  if (!policy.halfDays && (request.startHalf || request.endHalf)) {
    return { ok: false, reason: "This kind of leave is taken in whole days." };
  }

  let counted;
  try {
    counted = countLeaveDays(request, context.calendar, policy.count);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Check the dates and try again." };
  }
  const days = counted.total;
  if (days === 0) return { ok: false, reason: "These dates are all weekends or holidays.", days };

  const overlaps = context.requests.some(
    (other) =>
      (other.status === "pending" || other.status === "approved") &&
      other.startDate <= request.endDate &&
      other.endDate >= request.startDate,
  );
  if (overlaps) return { ok: false, reason: "You already have leave on some of these days.", days };

  const allowance = policy.allowance;
  if (allowance.kind === "perEvent") {
    if ((request.leaveType === "maternity" || request.leaveType === "paternity") && !request.childOrder) {
      return { ok: false, reason: "Say whether this is your first or second child, or a later one.", days };
    }
    if (allowance.withinDaysOfEvent !== null) {
      if (!request.eventDate) return { ok: false, reason: "Add the date of the birth.", days };
      const latest = addDays(request.eventDate, allowance.withinDaysOfEvent);
      if (request.startDate < request.eventDate || request.endDate > latest) {
        return { ok: false, reason: `This leave is taken within ${allowance.withinDaysOfEvent} days of the birth.`, days };
      }
    }
    const limit = request.childOrder === "later" && allowance.laterChildDays !== null ? allowance.laterChildDays : allowance.days;
    if (days > limit) return { ok: false, reason: `That’s more than the ${limit} days allowed.`, days };
    return { ok: true, days, leftAfter: limit - days, allowance: limit, count: policy.count };
  }

  if (allowance.kind === "perYear") {
    // Each leave year the request touches has to have room for its share.
    const years = [...new Set(counted.byDate.filter((d) => d.days).map((d) => Number(d.date.slice(0, 4))))];
    let leftAfter: number | null = null;
    for (const year of years) {
      const balance = balanceFor({ ...context, leaveType: request.leaveType, year });
      if (balance.kind !== "pool") continue;
      const after = balance.left - daysInYear(counted.byDate, year);
      if (after < 0) return { ok: false, reason: `That’s more than the ${balance.left} days you have left.`, days };
      leftAfter ??= after;
    }
    return { ok: true, days, leftAfter, allowance: null, count: policy.count };
  }

  return { ok: true, days, leftAfter: null, allowance: null, count: policy.count };
}
