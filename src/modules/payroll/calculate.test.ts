import { describe, expect, it } from "vitest";
import { resolveRules } from "@/modules/rules/resolve";
import type { EmploymentType, PayrollMonth, RuleRow } from "@/modules/rules/types";
import { V1_RULE_ROWS } from "@/modules/rules/v1";
import { calculateHealthContribution, calculatePay, type PayInput, type PayResult } from "./calculate";

const nu = (amount: number) => Math.round(amount * 100);
const SEPTEMBER = { year: 2026, month: 9 };
const OCTOBER = { year: 2026, month: 10 };

function rulesFor(employmentType: EmploymentType, month: PayrollMonth = OCTOBER, rows: RuleRow[] = V1_RULE_ROWS) {
  return resolveRules(rows, employmentType, month);
}

function salary(overrides: Partial<PayInput> & { basic?: number; allowances?: number } = {}): PayInput {
  const { basic = 40_000, allowances = 0, ...rest } = overrides;
  return {
    employmentType: "full_time",
    month: OCTOBER,
    regularPay: { kind: "salary", basic: nu(basic), allowances: nu(allowances) },
    unpaidLeaveDays: 0,
    lines: [],
    recoveries: [],
    ...rest,
  };
}

function stipend(amount: number, overrides: Partial<PayInput> = {}): PayInput {
  return {
    employmentType: "intern",
    month: OCTOBER,
    regularPay: { kind: "stipend", stipend: nu(amount) },
    unpaidLeaveDays: 0,
    lines: [],
    recoveries: [],
    ...overrides,
  };
}

// Every result produced in this file, checked against the take-home identity at the end.
const results: PayResult[] = [];
function pay(input: PayInput, rules = rulesFor(input.employmentType, input.month)): PayResult {
  const result = calculatePay(input, rules);
  results.push(result);
  return result;
}

const pfFromJuly: RuleRow = {
  id: "test:pf-from-july",
  key: "provident_fund",
  employmentType: "full_time",
  effectiveFrom: "2026-07-01",
  // Test-only rate. The real NPPF rate is set at registration in 2027.
  value: { enabled: true, employee_rate_bp: 1_000, round_to_ch: 100, rounding: "nearest" },
};

describe("a full month's salary", () => {
  it("follows the order gross, HC, PF, GIS, taxable, TDS, take-home", () => {
    const result = pay(salary({ basic: 50_000, allowances: 10_000 }));
    expect(result).toMatchObject({
      daysInMonth: 31,
      daysPaid: 31,
      regularPayDue: nu(60_000),
      gross: nu(60_000),
      healthContribution: nu(600),
      providentFund: 0,
      gis: 0,
      taxable: nu(60_000),
      taxableForTds: nu(60_000),
      tds: nu(5_125),
      recoveries: 0,
      takeHome: nu(54_275),
    });
  });

  it("records which rules it used", () => {
    expect(pay(salary()).ruleIds).toContain("v1:tds:full_time");
  });
});

describe("interns", () => {
  it("pay no TDS on a stipend of Nu. 25,000", () => {
    expect(pay(stipend(25_000))).toMatchObject({ gross: nu(25_000), tds: 0, healthContribution: nu(250), takeHome: nu(24_750) });
  });

  it("pay no TDS on a stipend below Nu. 25,000", () => {
    expect(pay(stipend(20_000))).toMatchObject({ tds: 0, healthContribution: nu(200) });
  });

  it("pay no HC when the intern HC setting is off", () => {
    const rows: RuleRow[] = [
      ...V1_RULE_ROWS,
      {
        id: "test:intern-hc-off",
        key: "health_contribution",
        employmentType: "intern",
        effectiveFrom: "2026-10-01",
        value: { enabled: false, rate_bp: 100, round_to_ch: 100, rounding: "nearest" },
      },
    ];
    expect(pay(stipend(20_000), rulesFor("intern", OCTOBER, rows))).toMatchObject({ healthContribution: 0, takeHome: nu(20_000) });
  });

  it("never pay PF, even when PF is on for full-time staff", () => {
    const rows = [...V1_RULE_ROWS, pfFromJuly];
    expect(pay(stipend(30_000), rulesFor("intern", OCTOBER, rows)).providentFund).toBe(0);
  });
});

describe("HC rounding setting", () => {
  const hcRule = (rounding: "nearest" | "down" | "up") => ({ enabled: true, rate: 100, roundTo: 100, rounding });

  it.each([
    ["nearest", 45_050, 451],
    ["down", 45_050, 450],
    ["up", 45_050, 451],
    ["nearest", 45_040, 450],
    ["down", 45_040, 450],
    ["up", 45_040, 451],
    ["nearest", 45_060, 451],
  ] as const)("%s on gross Nu. %i gives Nu. %i", (rounding, gross, expected) => {
    expect(calculateHealthContribution(nu(gross), hcRule(rounding))).toBe(nu(expected));
  });

  it("is read from the rule, not the code", () => {
    const rows: RuleRow[] = [
      ...V1_RULE_ROWS,
      {
        id: "test:hc-down",
        key: "health_contribution",
        employmentType: "full_time",
        effectiveFrom: "2026-10-01",
        value: { enabled: true, rate_bp: 100, round_to_ch: 100, rounding: "down" },
      },
    ];
    expect(pay(salary({ basic: 45_050 }), rulesFor("full_time", OCTOBER, rows)).healthContribution).toBe(nu(450));
    expect(pay(salary({ basic: 45_050 })).healthContribution).toBe(nu(451));
  });
});

describe("PF switched on from July 2026", () => {
  const rows = [...V1_RULE_ROWS, pfFromJuly];
  const june = { year: 2026, month: 6 };
  const july = { year: 2026, month: 7 };

  it("leaves June unchanged", () => {
    const withPfRule = pay(salary({ basic: 60_000, month: june }), rulesFor("full_time", june, rows));
    const without = pay(salary({ basic: 60_000, month: june }), rulesFor("full_time", june));
    expect(withPfRule).toEqual(without);
    expect(withPfRule.providentFund).toBe(0);
  });

  it("deducts PF from July, lowering taxable and TDS", () => {
    const result = pay(salary({ basic: 60_000, month: july }), rulesFor("full_time", july, rows));
    expect(result).toMatchObject({
      gross: nu(60_000),
      providentFund: nu(6_000),
      taxable: nu(54_000),
      tds: nu(3_933),
      healthContribution: nu(600),
      takeHome: nu(49_467),
    });
  });
});

describe("one-off lines", () => {
  it("adds an arrear to gross and taxes it in the month it is paid", () => {
    const result = pay(
      salary({ basic: 40_000, allowances: 5_000, lines: [{ kind: "arrear", amount: nu(10_000), note: "September increment" }] }),
    );
    expect(result).toMatchObject({ gross: nu(55_000), healthContribution: nu(550), tds: nu(4_125), takeHome: nu(50_325) });
  });

  it("adds a bonus to gross", () => {
    expect(pay(salary({ basic: 40_000, lines: [{ kind: "bonus", amount: nu(5_000), note: "Festival" }] })).gross).toBe(nu(45_000));
  });

  it("lets an admin adjustment raise or lower gross", () => {
    const result = pay(
      salary({
        basic: 40_000,
        lines: [
          { kind: "adjustment", amount: nu(2_000), note: "Correction" },
          { kind: "adjustment", amount: nu(-1_000), note: "Correction" },
        ],
      }),
    );
    expect(result.gross).toBe(nu(41_000));
  });

  it("takes an advance recovery from take-home without changing HC or TDS", () => {
    const without = pay(salary({ basic: 50_000 }));
    const withRecovery = pay(
      salary({ basic: 50_000, recoveries: [{ kind: "advance_recovery", amount: nu(5_000), note: "Advance, 1 of 4" }] }),
    );
    expect(withRecovery.healthContribution).toBe(without.healthContribution);
    expect(withRecovery.tds).toBe(without.tds);
    expect(withRecovery.recoveries).toBe(nu(5_000));
    expect(withRecovery.takeHome).toBe(without.takeHome - nu(5_000));
    expect(without).toMatchObject({ tds: nu(3_333), healthContribution: nu(500), takeHome: nu(46_167) });
  });
});

describe("proration by calendar days", () => {
  const monthly = { basic: 30_000, allowances: 6_000 };

  it("3 unpaid days in a 30-day month", () => {
    expect(pay(salary({ ...monthly, month: SEPTEMBER, unpaidLeaveDays: 3 }), rulesFor("full_time", SEPTEMBER))).toMatchObject({
      daysInMonth: 30,
      daysPaid: 27,
      regularPayDue: nu(32_400),
    });
  });

  it("3 unpaid days in a 31-day month", () => {
    expect(pay(salary({ ...monthly, unpaidLeaveDays: 3 }))).toMatchObject({ daysInMonth: 31, daysPaid: 28, regularPayDue: nu(32_516) });
  });

  it("a half day", () => {
    expect(pay(salary({ ...monthly, month: SEPTEMBER, unpaidLeaveDays: 0.5 }), rulesFor("full_time", SEPTEMBER))).toMatchObject({
      daysPaid: 29.5,
      regularPayDue: nu(35_400),
    });
  });

  it("February", () => {
    const february = { year: 2026, month: 2 };
    expect(pay(salary({ ...monthly, month: february, unpaidLeaveDays: 3 }), rulesFor("full_time", february))).toMatchObject({
      daysInMonth: 28,
      daysPaid: 25,
      regularPayDue: nu(32_143),
    });
  });

  it("a mid-month joiner is paid from their first day, inclusive", () => {
    expect(pay(salary({ ...monthly, joinedOn: "2026-10-15" }))).toMatchObject({ daysPaid: 17, regularPayDue: nu(19_742) });
  });

  it("a mid-month exit is paid to their last working day, inclusive", () => {
    expect(pay(salary({ ...monthly, lastWorkingDay: "2026-10-20" }))).toMatchObject({ daysPaid: 20, regularPayDue: nu(23_226) });
  });

  it("joining and leaving in the same month", () => {
    expect(pay(salary({ ...monthly, joinedOn: "2026-10-10", lastWorkingDay: "2026-10-20" }))).toMatchObject({
      daysPaid: 11,
      regularPayDue: nu(12_774),
    });
  });

  it("dates outside the month do not reduce pay", () => {
    expect(pay(salary({ ...monthly, joinedOn: "2025-03-01", lastWorkingDay: "2027-01-31" }))).toMatchObject({
      daysPaid: 31,
      regularPayDue: nu(36_000),
    });
  });

  it("rounds the prorated amount once, to the ngultrum, before HC and TDS", () => {
    // 36,000 × 28 / 31 = 32,516.13; rounded to 32,516 first, then HC = 1% of 32,516 = 325.16 → 325.
    const result = pay(salary({ ...monthly, unpaidLeaveDays: 3 }));
    expect(result.regularPayDue % 100).toBe(0);
    expect(result.healthContribution).toBe(nu(325));
  });

  it("prorates a stipend the same way", () => {
    expect(pay(stipend(20_000, { month: SEPTEMBER, unpaidLeaveDays: 3 }), rulesFor("intern", SEPTEMBER)).regularPayDue).toBe(nu(18_000));
  });

  it("does not prorate arrears or one-offs", () => {
    const result = pay(
      salary({ ...monthly, month: SEPTEMBER, unpaidLeaveDays: 3, lines: [{ kind: "arrear", amount: nu(1_000), note: "" }] }),
      rulesFor("full_time", SEPTEMBER),
    );
    expect(result.gross).toBe(nu(33_400));
  });
});

describe("rules come from data", () => {
  it("changes the result when a rule value changes, with no code change", () => {
    const rows: RuleRow[] = V1_RULE_ROWS.map((row) =>
      row.key === "health_contribution" && row.employmentType === "full_time"
        ? { ...row, value: { enabled: true, rate_bp: 200, round_to_ch: 100, rounding: "nearest" } }
        : row,
    );
    expect(pay(salary({ basic: 40_000 })).healthContribution).toBe(nu(400));
    expect(pay(salary({ basic: 40_000 }), rulesFor("full_time", OCTOBER, rows)).healthContribution).toBe(nu(800));
  });
});

describe("input checks", () => {
  const rules = rulesFor("full_time");

  it.each<[string, PayInput]>([
    ["money that is not whole chhertum", salary({ regularPay: { kind: "salary", basic: 4_000_000.5, allowances: 0 } })],
    ["a negative basic", salary({ regularPay: { kind: "salary", basic: -1, allowances: 0 } })],
    ["a negative arrear", salary({ lines: [{ kind: "arrear", amount: -100, note: "" }] })],
    ["a negative recovery", salary({ recoveries: [{ kind: "advance_recovery", amount: -100, note: "" }] })],
    ["unpaid days that are not whole or half days", salary({ unpaidLeaveDays: 1.25 })],
    ["more unpaid days than days employed", salary({ joinedOn: "2026-10-30", unpaidLeaveDays: 3 })],
    ["someone who left before the month", salary({ lastWorkingDay: "2026-09-30" })],
    ["someone who joins after the month", salary({ joinedOn: "2026-11-01" })],
    ["a stipend for a full-time employee", salary({ regularPay: { kind: "stipend", stipend: nu(20_000) } })],
    ["an adjustment that makes gross negative", salary({ basic: 1_000, lines: [{ kind: "adjustment", amount: nu(-2_000), note: "" }] })],
    ["a date that does not exist", salary({ joinedOn: "2026-02-30" })],
  ])("rejects %s", (_label, input) => {
    expect(() => calculatePay(input, rules)).toThrow();
  });

  it("rejects rules for a different employment type", () => {
    expect(() => calculatePay(stipend(20_000), rules)).toThrow(/employment type/i);
  });

  it("rejects rules for a different month", () => {
    expect(() => calculatePay(salary({ month: SEPTEMBER }), rules)).toThrow(/month/i);
  });
});

describe("take-home", () => {
  it("is always gross − PF − GIS − TDS − HC − recoveries", () => {
    expect(results.length).toBeGreaterThan(20);
    for (const r of results) {
      expect(r.takeHome).toBe(r.gross - r.providentFund - r.gis - r.tds - r.healthContribution - r.recoveries);
      expect(r.taxable).toBe(r.gross - r.providentFund - r.gis);
      for (const amount of [r.gross, r.healthContribution, r.providentFund, r.tds, r.takeHome]) {
        expect(Number.isSafeInteger(amount)).toBe(true);
      }
    }
  });
});
