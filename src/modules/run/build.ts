import { firstNameFrom } from "@/lib/auth/roles";
import { addMonths, firstOfMonth, formatMonth, monthBounds } from "@/lib/format";
import type { LeaveRequestFacts } from "@/modules/leave/balance";
import { type Holiday, expandHolidays } from "@/modules/leave/holidays";
import { unpaidLeaveDays } from "@/modules/leave/unpaid";
import { type PayInput, type PayResult, calculatePay } from "@/modules/payroll";
import { type PayTerms, payInForce, regularPayOf } from "@/modules/people/pay";
import { resolveLeaveRules, resolvePayrollSettings, resolveRules } from "@/modules/rules/resolve";
import type { Chhertum, EmploymentType, PayrollMonth, PlainDate, ResolvedRules, RuleRow } from "@/modules/rules/types";
import { type RunCheck, checksFor } from "./checks";
import { type RunException, exceptionsFor } from "./exceptions";
import { type RunLine, payInputLines } from "./lines";

// A month's payroll run, worked out from scratch every time it's read while it is a draft:
// who is employed, their pay in force, the month's rules, unpaid leave and one-off lines, through
// the unchanged payroll calculation. Pure: everything comes in, nothing is read or written here.

export type RunPerson = {
  id: string;
  fullName: string;
  startDate: string;
  endDate: string | null;
  pay: PayTerms[];
  hasTpn: boolean;
  hasBankAccount: boolean;
  leave: LeaveRequestFacts[];
  pendingChange: { id: string; fields: ("phone" | "bank")[] } | null;
};

export type RunInput = {
  month: PayrollMonth;
  /** Everyone; the run picks out who is employed in the month. */
  people: RunPerson[];
  lines: RunLine[];
  ruleRows: RuleRow[];
  holidays: Holiday[];
  firstMonth: PayrollMonth | null;
  lockedMonths: PayrollMonth[];
  /** Each person's take-home in the locked month before this one. */
  previousTakeHome: Record<string, Chhertum>;
  acknowledged: readonly string[];
  /** Today in Thimphu. A month can't be locked before it starts. */
  today?: string;
};

export type PersonRun = {
  personId: string;
  fullName: string;
  firstName: string;
  startDate: string;
  endDate: string | null;
  terms: PayTerms | null;
  employmentType: EmploymentType | null;
  unpaidLeaveDays: number;
  lines: RunLine[];
  rules: ResolvedRules | null;
  input: PayInput | null;
  result: PayResult | null;
  /** Why pay couldn't be worked out, in plain words. */
  problem: string | null;
  /** Everything between gross and take-home: HC, PF, GIS, TDS and after-tax recoveries. */
  deductions: Chhertum;
  previousTakeHome: Chhertum | null;
  exceptions: RunException[];
};

export type RunTotals = {
  people: number;
  gross: Chhertum;
  healthContribution: Chhertum;
  providentFund: Chhertum;
  gis: Chhertum;
  tds: Chhertum;
  recoveries: Chhertum;
  takeHome: Chhertum;
  /** TDS + HC, paid to DRC. */
  remit: Chhertum;
};

export type RunView = {
  month: PayrollMonth;
  people: PersonRun[];
  totals: RunTotals;
  checks: RunCheck[];
  dueDate: PlainDate;
  /** Every check is cleared or acknowledged. */
  ready: boolean;
  ruleIds: string[];
};

export const monthIndex = ({ year, month }: PayrollMonth) => year * 12 + month - 1;

export function employedIn(person: Pick<RunPerson, "startDate" | "endDate">, month: PayrollMonth): boolean {
  const { from, to } = monthBounds(month);
  return person.startDate <= to && (person.endDate === null || person.endDate >= from);
}

function problemFrom(error: unknown, month: PayrollMonth): string {
  const message = error instanceof Error ? error.message : "";
  const name = formatMonth(month);
  if (/More unpaid leave/.test(message)) return `Their unpaid leave is longer than their time employed in ${name}. Check their leave.`;
  if (/gross pay negative/.test(message)) return "Their leave recovery is more than their pay. Lower it.";
  if (/^No \w+ rule/.test(message)) return `There are no pay rules for ${name} yet.`;
  return `Check their pay and leave for ${name}.`;
}

function calculatePerson(person: RunPerson, run: RunInput, lines: RunLine[], largeChange: number): PersonRun {
  const { month } = run;
  const terms = payInForce(person.pay, month);
  const base: PersonRun = {
    personId: person.id,
    fullName: person.fullName,
    firstName: firstNameFrom(person.fullName, ""),
    startDate: person.startDate,
    endDate: person.endDate,
    terms,
    employmentType: terms?.employmentType ?? null,
    unpaidLeaveDays: 0,
    lines,
    rules: null,
    input: null,
    result: null,
    problem: null,
    deductions: 0,
    previousTakeHome: run.previousTakeHome[person.id] ?? null,
    exceptions: [],
  };
  if (!terms) return { ...base, exceptions: exceptionsFor(base, person, month, largeChange) };

  try {
    const rules = resolveRules(run.ruleRows, terms.employmentType, month);
    const calendar = {
      workingWeek: resolveLeaveRules(run.ruleRows, terms.employmentType, month).workingWeek,
      holidays: expandHolidays(run.holidays),
    };
    const unpaid = unpaidLeaveDays(person.leave, month, calendar);
    const input: PayInput = {
      employmentType: terms.employmentType,
      month,
      regularPay: regularPayOf(terms),
      joinedOn: person.startDate as PlainDate,
      ...(person.endDate ? { lastWorkingDay: person.endDate as PlainDate } : {}),
      unpaidLeaveDays: unpaid,
      ...payInputLines(lines),
    };
    const done = { ...base, unpaidLeaveDays: unpaid, rules, input };
    try {
      const result = calculatePay(input, rules);
      const calculated = { ...done, result, deductions: result.gross - result.takeHome };
      return { ...calculated, exceptions: exceptionsFor(calculated, person, month, largeChange) };
    } catch (error) {
      const failed = { ...done, problem: problemFrom(error, month) };
      return { ...failed, exceptions: exceptionsFor(failed, person, month, largeChange) };
    }
  } catch (error) {
    const failed = { ...base, problem: problemFrom(error, month) };
    return { ...failed, exceptions: exceptionsFor(failed, person, month, largeChange) };
  }
}

const sum = (people: PersonRun[], pick: (result: PayResult) => Chhertum) =>
  people.reduce((total, person) => total + (person.result ? pick(person.result) : 0), 0);

export function buildRun(input: RunInput): RunView {
  const settings = resolvePayrollSettings(input.ruleRows, input.month);
  const employed = input.people
    .filter((person) => employedIn(person, input.month))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const people = employed.map((person) =>
    calculatePerson(
      person,
      input,
      input.lines.filter((line) => line.personId === person.id),
      settings.largeChange,
    ),
  );

  const tds = sum(people, (r) => r.tds);
  const healthContribution = sum(people, (r) => r.healthContribution);
  const totals: RunTotals = {
    people: people.filter((person) => person.result).length,
    gross: sum(people, (r) => r.gross),
    healthContribution,
    providentFund: sum(people, (r) => r.providentFund),
    gis: sum(people, (r) => r.gis),
    tds,
    recoveries: sum(people, (r) => r.recoveries),
    takeHome: sum(people, (r) => r.takeHome),
    remit: tds + healthContribution,
  };

  const checks = checksFor(input, employed, people);
  const next = addMonths(input.month, 1);
  const dueDate = `${firstOfMonth(next).slice(0, 8)}${String(settings.dueDay).padStart(2, "0")}` as PlainDate;
  const ruleIds = [...new Set([...people.flatMap((person) => person.result?.ruleIds ?? []), ...settings.ruleIds])];

  return {
    month: input.month,
    people,
    totals,
    checks,
    dueDate,
    ready: checks.every((check) => check.kind === "acknowledge" && check.acknowledged),
    ruleIds,
  };
}

export type LineTry = { ok: true; takeHome: Chhertum } | { ok: false; reason: string };

/** Whether a new line can be added: worked out with the line in place, refused if take-home would go below zero. */
export function tryLine(input: RunInput, line: RunLine): LineTry {
  const person = input.people.find((p) => p.id === line.personId);
  if (!person || !employedIn(person, input.month)) return { ok: false, reason: `This person isn’t paid in ${formatMonth(input.month)}.` };
  const firstName = firstNameFrom(person.fullName, "");
  const lines = [...input.lines.filter((l) => l.personId === person.id), line];
  const result = calculatePerson(person, input, lines, resolvePayrollSettings(input.ruleRows, input.month).largeChange);
  if (!result.terms) return { ok: false, reason: `Add ${firstName}’s pay first.` };
  if (!result.result || result.result.takeHome < 0) {
    return { ok: false, reason: `That’s more than ${firstName}’s take-home this month. Recover the rest next month.` };
  }
  return { ok: true, takeHome: result.result.takeHome };
}
