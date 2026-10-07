import { describe, expect, it } from "vitest";
import { resolveCompanyDetails } from "@/modules/rules/resolve";
import type { RunPerson } from "@/modules/run/build";
import { MIXED_LINES, OCTOBER, RULES, line, mixedTeam, nu, person, personIn, salary, snapshotOf } from "../../../tests/support/mixed-team";
import { payslipModel, payslipReference } from "./model";

// A payslip prints what was locked, nothing else. These build the milestone 4 mixed team through the
// real run calculation, turn each person into a snapshot exactly as lockPayroll stores it, and check
// every printed figure against that snapshot.

const COMPANY = resolveCompanyDetails(RULES, OCTOBER);
const run = mixedTeam([...MIXED_LINES, line("sonam", "leave_recovery", 1_000, "Leave taken beyond entitlement")]);
const snapshot = (id: string) => snapshotOf(personIn(run, id));

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
    const solo: RunPerson[] = [person("solo", "Solo Person", { pay: [salary(30_000, 0)] })];
    const p = personIn(mixedTeam([], solo), "solo");
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
    expect(payslipModel(snapshotOf(personIn(run, "karma"), null), COMPANY, "XS-202610-001", "2026-10-31").person.tpn).toBe("TPN not on file");
  });

  it("numbers payslips by month and position", () => {
    expect(payslipReference(OCTOBER, 7)).toBe("XS-202610-007");
    expect(payslipReference({ year: 2027, month: 1 }, 112)).toBe("XS-202701-112");
  });
});

