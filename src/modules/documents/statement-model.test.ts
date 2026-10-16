import { describe, expect, it } from "vitest";
import { resolveCompanyDetails } from "@/modules/rules/resolve";
import { OCTOBER, RULES, mixedTeam, nu, personIn, snapshotOf } from "../../../tests/support/mixed-team";
import { periodName, quickRange, statementModel, statementReference, type StatementSnapshot } from "./statement-model";

// A statement's figures are the locked snapshots' and nothing else; its totals are their sums.

const COMPANY = resolveCompanyDetails(RULES, OCTOBER);
const m = (year: number, month: number) => ({ year, month });
const snap = (month: { year: number; month: number }, gross: number, takeHome: number, imported = false): StatementSnapshot => ({
  month,
  employmentType: "full_time",
  gross: nu(gross),
  takeHome: nu(takeHome),
  imported,
});

const statement = (snapshots: StatementSnapshot[], from = m(2026, 4), to = m(2026, 10)) =>
  statementModel({ person: { name: "Sonam Wangmo", tpnLast4: "0012" }, range: { from, to }, snapshots, company: COMPANY, reference: "XS-PS-2026-0001", issuedOn: "2026-11-02" });

describe("figures and totals", () => {
  it("each month is its snapshot, and the totals are the sums of the snapshots", () => {
    // Sonam's October as locked by the real run: 2 days unpaid.
    const october = snapshotOf(personIn(mixedTeam(), "sonam")).result;
    const snapshots = [snap(m(2026, 8), 45_000, 41_967), snap(m(2026, 9), 45_000, 41_967), { month: OCTOBER, employmentType: "full_time" as const, gross: october.gross, takeHome: october.takeHome, imported: false }];
    const model = statement(snapshots, m(2026, 8), m(2026, 10));
    expect(model.lines.map((line) => (line.kind === "paid" ? [line.monthName, line.gross, line.deductions, line.takeHome] : line.monthName))).toEqual([
      ["August 2026", nu(45_000), nu(3_033), nu(41_967)],
      ["September 2026", nu(45_000), nu(3_033), nu(41_967)],
      ["October 2026", october.gross, october.gross - october.takeHome, october.takeHome],
    ]);
    const sum = (pick: (s: StatementSnapshot) => number) => snapshots.reduce((total, s) => total + pick(s), 0);
    expect(model.totals).toEqual({ gross: sum((s) => s.gross), deductions: sum((s) => s.gross - s.takeHome), takeHome: sum((s) => s.takeHome) });
    expect(model.paidMonths).toBe(3);
  });

  it("spans imported and live months, and says when any are imported", () => {
    const model = statement([snap(m(2026, 7), 40_000, 37_000, true), snap(m(2026, 8), 40_000, 37_000, true), snap(m(2026, 9), 45_000, 41_967)], m(2026, 7), m(2026, 9));
    expect(model.lines.map((line) => line.kind === "paid" && line.imported)).toEqual([true, true, false]);
    expect(model.anyImported).toBe(true);
    expect(model.totals.takeHome).toBe(nu(37_000 + 37_000 + 41_967));
    expect(statement([snap(m(2026, 9), 45_000, 41_967)], m(2026, 9), m(2026, 9)).anyImported).toBe(false);
  });

  it("lists a month in the range with no pay as not paid, and leaves it out of the totals", () => {
    const model = statement([snap(m(2026, 4), 45_000, 41_967), snap(m(2026, 6), 45_000, 41_967)], m(2026, 4), m(2026, 6));
    expect(model.lines.map((line) => line.kind)).toEqual(["paid", "not_paid", "paid"]);
    expect(model.paidMonths).toBe(2);
    expect(model.totals.takeHome).toBe(nu(83_934));
  });

  it("ignores snapshots outside the range", () => {
    const model = statement([snap(m(2026, 3), 99_999, 99_999), snap(m(2026, 4), 45_000, 41_967)], m(2026, 4), m(2026, 4));
    expect(model.totals.gross).toBe(nu(45_000));
  });

  it("names who it's for, the period and the issue", () => {
    const model = statement([snap(m(2026, 4), 45_000, 41_967)], m(2026, 4), m(2026, 9));
    expect(model.person).toEqual({ name: "Sonam Wangmo", employmentType: "Full-time", tpn: "TPN ••••0012" });
    expect(model.period).toBe("April to September 2026");
    expect(model.issuedOn).toBe("2 November 2026");
    expect(model.title).toBe("Pay statement");
  });
});

describe("ranges", () => {
  const paid = [m(2025, 11), m(2025, 12), m(2026, 1), m(2026, 2), m(2026, 3), m(2026, 4), m(2026, 5), m(2026, 6), m(2026, 7), m(2026, 8), m(2026, 9)];

  it("the last 3, 6 or 12 months end with the latest month paid", () => {
    expect(quickRange(paid, 3)).toEqual({ from: m(2026, 7), to: m(2026, 9) });
    expect(quickRange(paid, 6)).toEqual({ from: m(2026, 4), to: m(2026, 9) });
  });

  it("never start before the first month paid", () => {
    expect(quickRange(paid, 12)).toEqual({ from: m(2025, 11), to: m(2026, 9) });
    expect(quickRange([m(2026, 6), m(2026, 7)], 6)).toEqual({ from: m(2026, 6), to: m(2026, 7) });
  });

  it("there's no range with nothing paid", () => {
    expect(quickRange([], 6)).toBeNull();
  });

  it("are named plainly", () => {
    expect(periodName({ from: m(2026, 4), to: m(2026, 9) })).toBe("April to September 2026");
    expect(periodName({ from: m(2025, 11), to: m(2026, 4) })).toBe("November 2025 to April 2026");
    expect(periodName({ from: m(2026, 9), to: m(2026, 9) })).toBe("September 2026");
  });
});

it("references count up within the year", () => {
  expect(statementReference(2026, 4)).toBe("XS-PS-2026-0004");
});
