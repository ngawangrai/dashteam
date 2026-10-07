import type { PayslipSnapshot } from "@/modules/documents/model";
import { V1_HOLIDAYS } from "@/modules/leave/holidays-v1";
import type { PayTerms } from "@/modules/people/pay";
import type { RuleRow } from "@/modules/rules/types";
import { V1_COMPANY_RULE_ROWS, V1_FILING_RULE_ROWS, V1_LEAVE_RULE_ROWS, V1_RULE_ROWS, V1_SETTINGS_RULE_ROWS } from "@/modules/rules/v1";
import { type PersonRun, type RunPerson, type RunView, buildRun } from "@/modules/run/build";
import type { RunLine } from "@/modules/run/lines";

// The milestone 4 mixed team, worked out through the real run calculation, for tests that read what
// was locked: payslips (milestone 5) and the IT-1(a) schedule (milestone 6). Test support only.

export const nu = (amount: number) => Math.round(amount * 100);
export const OCTOBER = { year: 2026, month: 10 };
export const RULES: RuleRow[] = [...V1_RULE_ROWS, ...V1_LEAVE_RULE_ROWS, ...V1_SETTINGS_RULE_ROWS, ...V1_COMPANY_RULE_ROWS, ...V1_FILING_RULE_ROWS];

export const salary = (basic: number, allowances: number, effectiveFrom = "2025-01-01") =>
  ({ effectiveFrom, employmentType: "full_time", basic: nu(basic), allowances: nu(allowances) }) as PayTerms;
export const stipend = (amount: number) => ({ effectiveFrom: "2025-01-01", employmentType: "intern", stipend: nu(amount) }) as PayTerms;

export const person = (id: string, name: string, fields: Partial<RunPerson> = {}): RunPerson => ({
  id,
  fullName: name,
  startDate: "2025-01-06",
  endDate: null,
  pay: [salary(40_000, 5_000)],
  hasTpn: true,
  hasBankAccount: true,
  leave: [],
  pendingChange: null,
  ...fields,
});

export const line = (personId: string, kind: RunLine["kind"], amount: number, note = ""): RunLine => ({
  id: `${personId}-${kind}-${amount}`,
  personId,
  kind,
  amount: nu(amount),
  note,
  source: "manual",
});

/** Karma: a full month with an arrear and an advance recovery. Dechen: an intern. Pema joins on the
 * 15th, Tshering leaves on the 20th, Sonam takes 2 days unpaid. */
export const MIXED_TEAM: RunPerson[] = [
  person("karma", "Karma Wangchuk", { pay: [salary(50_000, 10_000)] }),
  person("dechen", "Dechen Lhamo", { pay: [stipend(20_000)] }),
  person("pema", "Pema Choden", { startDate: "2026-10-15", pay: [salary(40_000, 5_000, "2026-10-01")] }),
  person("tshering", "Tshering Dorji", { endDate: "2026-10-20", pay: [salary(60_000, 10_000)] }),
  person("sonam", "Sonam Wangmo", {
    leave: [{ id: "u", leaveType: "unpaid", status: "approved", startDate: "2026-10-07", endDate: "2026-10-08", startHalf: false, endHalf: false, childOrder: null }],
  }),
];

export const MIXED_LINES = [line("karma", "arrear", 5_000, "September increment"), line("karma", "advance_recovery", 3_000, "Advance, 1 of 3")];

export function mixedTeam(lines: RunLine[] = MIXED_LINES, people: RunPerson[] = MIXED_TEAM, ruleRows: RuleRow[] = RULES): RunView {
  return buildRun({
    month: OCTOBER,
    people,
    lines,
    ruleRows,
    holidays: V1_HOLIDAYS.map((h) => ({ ...h })),
    firstMonth: OCTOBER,
    lockedMonths: [],
    previousTakeHome: {},
    acknowledged: [],
  });
}

/** What lockPayroll writes to payroll_snapshots for one person, as later milestones read it back. */
export function snapshotOf(p: PersonRun, tpnLast4: string | null = "1234"): PayslipSnapshot {
  if (!p.result || !p.employmentType || !p.input) throw new Error(`${p.personId} wasn't worked out`);
  return {
    month: OCTOBER,
    fullName: p.fullName,
    employmentType: p.employmentType,
    person: { tpnLast4 },
    inputs: { terms: p.terms, startDate: p.startDate, endDate: p.endDate, unpaidLeaveDays: p.unpaidLeaveDays, lines: p.lines, payInput: p.input },
    result: p.result,
  };
}

export function personIn(run: RunView, id: string): PersonRun {
  const found = run.people.find((candidate) => candidate.personId === id);
  if (!found) throw new Error(`${id} isn't in the run`);
  return found;
}
