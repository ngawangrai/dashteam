import { resolveLeaveRules } from "@/modules/rules/resolve";
import type { Chhertum, EmploymentType, LeaveType, RuleRow } from "@/modules/rules/types";
import { type Employment, type LeaveRequestFacts, entitlementFor, monthsEmployedInYear } from "./balance";
import { type LeaveCalendar, countLeaveDays, daysInYear } from "./days";

// What leave looks like when someone leaves: days taken beyond the entitlement for the months worked
// become a suggested recovery (never deducted automatically), and unused annual days are shown.

export type ExitSettlement = {
  year: number;
  types: { leaveType: LeaveType; entitlement: number; used: number; over: number }[];
  daysOver: number;
  /** (basic + allowance, or stipend) ÷ calendar days in the exit month, in chhertum. */
  dailyRate: Chhertum;
  /** daysOver × the daily rate, rounded to the nearest ngultrum (half up). */
  suggested: Chhertum;
  unusedAnnualDays: number;
  /** Paying out unused annual leave is a rule, off by default: no amount until it's switched on. */
  payout: Chhertum | null;
};

type ExitInput = {
  person: Employment & { endDate: string };
  employmentType: EmploymentType;
  monthlyPay: Chhertum;
  requests: readonly LeaveRequestFacts[];
  ruleRows: readonly RuleRow[];
  calendar: LeaveCalendar;
};

const CH_PER_NU = 100n;

/** monthlyPay × halfDays ÷ (2 × days in month), rounded half up to `unit` chhertum. */
function proratedAmount(monthlyPay: Chhertum, halfDays: number, daysInMonth: number, unit: bigint): Chhertum {
  const numerator = BigInt(monthlyPay) * BigInt(halfDays);
  const divisor = BigInt(2 * daysInMonth) * unit;
  return Number(((numerator * 2n + divisor) / (divisor * 2n)) * unit);
}

export function exitSettlement(input: ExitInput): ExitSettlement {
  const year = Number(input.person.endDate.slice(0, 4));
  const rules = resolveLeaveRules(input.ruleRows, input.employmentType, { year, month: 1 });
  const months = monthsEmployedInYear(year, input.person, rules.prorationCutoffDay);

  const types = Object.entries(rules.policy).flatMap(([leaveType, policy]) => {
    if (!policy || policy.allowance.kind !== "perYear" || !policy.allowance.prorate) return [];
    const entitlement = entitlementFor(policy.allowance, months);
    const used = input.requests
      .filter((request) => request.leaveType === leaveType && request.status === "approved")
      .reduce((sum, request) => sum + daysInYear(countLeaveDays(request, input.calendar, policy.count).byDate, year), 0);
    return [{ leaveType: leaveType as LeaveType, entitlement, used, over: Math.max(0, used - entitlement) }];
  });

  const daysOver = types.reduce((sum, type) => sum + type.over, 0);
  const exitMonth = Number(input.person.endDate.slice(5, 7));
  const daysInExitMonth = new Date(Date.UTC(year, exitMonth, 0)).getUTCDate();
  const annual = types.find((type) => type.leaveType === "annual");
  const unusedAnnualDays = annual ? Math.max(0, annual.entitlement - annual.used) : 0;

  return {
    year,
    types,
    daysOver,
    dailyRate: proratedAmount(input.monthlyPay, 2, daysInExitMonth, 1n),
    suggested: proratedAmount(input.monthlyPay, daysOver * 2, daysInExitMonth, CH_PER_NU),
    unusedAnnualDays,
    payout: rules.exitPayout.enabled ? proratedAmount(input.monthlyPay, unusedAnnualDays * 2, daysInExitMonth, CH_PER_NU) : null,
  };
}
