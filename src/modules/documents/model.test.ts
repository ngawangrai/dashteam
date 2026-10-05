import { describe, expect, it } from "vitest";
import { V1_HOLIDAYS } from "@/modules/leave/holidays-v1";
import type { PayTerms } from "@/modules/people/pay";
import { resolveCompanyDetails } from "@/modules/rules/resolve";
import type { RuleRow } from "@/modules/rules/types";
import { V1_COMPANY_RULE_ROWS, V1_LEAVE_RULE_ROWS, V1_RULE_ROWS, V1_SETTINGS_RULE_ROWS } from "@/modules/rules/v1";
import { type PersonRun, type RunPerson, buildRun } from "@/modules/run/build";
import type { RunLine } from "@/modules/run/lines";
import { type PayslipSnapshot, payslipModel, payslipReference } from "./model";

// A payslip prints what was locked, nothing else. These build the milestone 4 mixed team through the
// real run calculation, turn each person into a snapshot exactly as lockPayroll stores it, and check
// every printed figure against that snapshot.

const nu = (amount: number) => Math.round(amount * 100);
const OCTOBER = { year: 2026, month: 10 };
const RULES: RuleRow[] = [...V1_RULE_ROWS, ...V1_LEAVE_RULE_ROWS, ...V1_SETTINGS_RULE_ROWS, ...V1_COMPANY_RULE_ROWS];
const COMPANY = resolveCompanyDetails(RULES, OCTOBER);

const salary = (basic: number, allowances: number, effectiveFrom = "2025-01-01") =>
  ({ effectiveFrom, employmentType: "full_time", basic: nu(basic), allowances: nu(allowances) }) as PayTerms;
const stipend = (amount: number) => ({ effectiveFrom: "2025-01-01", employmentType: "intern", stipend: nu(amount) }) as PayTerms;

const person = (id: string, name: string, fields: Partial<RunPerson> = {}): RunPerson => ({
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

const line = (personId: string, kind: RunLine["kind"], amount: number, note = ""): RunLine => ({ id: `${personId}-${kind}`, personId, kind, amount: nu(amount), note, source: "manual" });

const run = buildRun({
  month: OCTOBER,
  people: [
    person("karma", "Karma Wangchuk", { pay: [salary(50_000, 10_000)] }),
    person("dechen", "Dechen Lhamo", { pay: [stipend(20_000)] }),
    person("pema", "Pema Choden", { startDate: "2026-10-15", pay: [salary(40_000, 5_000, "2026-10-01")] }),
    person("tshering", "Tshering Dorji", { endDate: "2026-10-20", pay: [salary(60_000, 10_000)] }),
    person("sonam", "Sonam Wangmo", {
      leave: [{ id: "u", leaveType: "unpaid", status: "approved", startDate: "2026-10-07", endDate: "2026-10-08", startHalf: false, endHalf: false, childOrder: null }],
    }),
  ],
  lines: [line("karma", "arrear", 5_000, "September increment"), line("karma", "advance_recovery", 3_000, "Advance, 1 of 3"), line("sonam", "leave_recovery", 1_000, "Leave taken beyond entitlement")],
  ruleRows: RULES,
  holidays: V1_HOLIDAYS.map((h) => ({ ...h })),
  firstMonth: OCTOBER,
  lockedMonths: [],
  previousTakeHome: {},
  acknowledged: [],
});

/** What lockPayroll writes to payroll_snapshots for one person, as the payslip reads it back. */
function snapshotOf(p: PersonRun, tpnLast4: string | null = "1234"): PayslipSnapshot {
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

const snapshot = (id: string) => {
  const p = run.people.find((candidate) => candidate.personId === id);
  if (!p) throw new Error(id);
  return snapshotOf(p);
};

const model = (id: string) => payslipModel(snapshot(id), COMPANY, "XS-202610-001", "2026-10-31", "Tashi");
const rows = (lines: { label: string; amount: number }[]) => lines.map((l) => `${l.label} ${l.amount / 100}`);

describe("every figure on the payslip is the locked snapshot's", () => {
  it.each(["karma", "dechen", "pema", "tshering", "sonam"])("%s", (id) => {
    const locked = snapshot(id).result;
    const printed = model(id);
    expect(printed.takeHome).toBe(locked.takeHome);
    expect(printed.gross).toBe(locked.gross);
    expect(printed.totalDeductions).toBe(locked.gross - locked.takeHome);
    // The rows add up to what they total: earnings to gross, deductions to the total.
    expect(printed.earnings.reduce((sum, row) => sum + row.amount, 0)).toBe(locked.gross);
    expect(printed.deductions.reduce((sum, row) => sum + row.amount, 0)).toBe(printed.totalDeductions);
    expect(printed.deductions.find((row) => row.label === "TDS")?.amount).toBe(locked.tds);
    expect(printed.deductions.find((row) => row.label === "Health contribution")?.amount).toBe(locked.healthContribution);
  });

  it("lists a full month's salary as basic and allowances, then one-offs with their notes", () => {
    const karma = model("karma");
    expect(rows(karma.earnings)).toEqual(["Basic 50000", "Allowances 10000", "Arrear 5000"]);
    expect(karma.earnings[2]?.detail).toBe("September increment");
    expect(rows(karma.deductions)).toEqual(["Health contribution 650", "TDS 6125", "Advance recovery 3000"]);
    expect(karma).toMatchObject({ gross: nu(65_000), totalDeductions: nu(9_775), takeHome: nu(55_225) });
  });

  it("shows a part month as one line with the days paid, never a split it would have to round", () => {
    expect(model("pema").earnings[0]).toEqual({ label: "Basic and allowances", detail: "17 of 31 days", amount: nu(24_677) });
    expect(model("tshering").earnings[0]?.detail).toBe("20 of 31 days");
  });

  it("says how many days were unpaid, and takes a leave recovery off earnings", () => {
    const sonam = model("sonam");
    expect(sonam.earnings[0]).toMatchObject({ label: "Basic and allowances", detail: "29 of 31 days (2 days unpaid)" });
    expect(sonam.earnings[1]).toEqual({ label: "Leave recovery", detail: "Leave taken beyond entitlement", amount: -nu(1_000) });
  });
});

describe("a stipend payslip", () => {
  it("has a stipend and no salary-only lines", () => {
    const dechen = model("dechen");
    expect(rows(dechen.earnings)).toEqual(["Stipend 20000"]);
    expect(dechen.person.employmentType).toBe("Intern");
    expect(JSON.stringify(dechen)).not.toMatch(/Basic|Allowances/);
  });
});

describe("rows that don't apply are left out", () => {
  it("has no PF or GIS rows when they are zero", () => {
    expect(model("karma").deductions.map((row) => row.label)).not.toEqual(expect.arrayContaining(["Provident fund", "GIS"]));
  });

  it("shows PF when it was taken", () => {
    const source = snapshot("karma");
    const withPf = { ...source, result: { ...source.result, providentFund: nu(6_500), takeHome: source.result.takeHome - nu(6_500) } };
    expect(payslipModel(withPf, COMPANY, "XS-202610-001", "2026-10-31").deductions.map((row) => row.label)).toContain("Provident fund");
  });

  it("leaves out an allowance of zero", () => {
    const p = buildRun({ ...runInputFor(person("solo", "Solo Person", { pay: [salary(30_000, 0)] })) }).people[0];
    if (!p) throw new Error("no run");
    expect(rows(payslipModel(snapshotOf(p), COMPANY, "XS-202610-001", "2026-10-31").earnings)).toEqual(["Basic 30000"]);
  });
});

describe("who and what it's for", () => {
  it("names the company, month, person and type, with the TPN masked", () => {
    expect(model("karma")).toMatchObject({
      company: { name: "Xceed Studio", addressLines: [], showLogo: false },
      title: "Payslip · October 2026",
      monthName: "October 2026",
      person: { name: "Karma Wangchuk", employmentType: "Full-time", tpn: "TPN ••••1234" },
      reference: "XS-202610-001",
      issuedOn: "31 October 2026",
      contact: "Tashi",
    });
  });

  it("says when there's no TPN on file", () => {
    const p = run.people.find((candidate) => candidate.personId === "karma");
    if (!p) throw new Error("no karma");
    expect(payslipModel(snapshotOf(p, null), COMPANY, "XS-202610-001", "2026-10-31").person.tpn).toBe("TPN not on file");
  });

  it("numbers payslips by month and position", () => {
    expect(payslipReference(OCTOBER, 7)).toBe("XS-202610-007");
    expect(payslipReference({ year: 2027, month: 1 }, 112)).toBe("XS-202701-112");
  });
});

function runInputFor(p: RunPerson) {
  return { month: OCTOBER, people: [p], lines: [], ruleRows: RULES, holidays: [], firstMonth: OCTOBER, lockedMonths: [], previousTakeHome: {}, acknowledged: [] };
}
