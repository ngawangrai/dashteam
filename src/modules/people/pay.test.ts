import { describe, expect, it } from "vitest";
import { calculatePay } from "@/modules/payroll";
import { resolveRules } from "@/modules/rules/resolve";
import { V1_RULE_ROWS } from "@/modules/rules/v1";
import { type PayTerms, nextPayChange, payInForce, regularPayOf } from "./pay";

const OCTOBER = { year: 2026, month: 10 };
const NOVEMBER = { year: 2026, month: 11 };

const joining: PayTerms = { effectiveFrom: "2025-03-01", employmentType: "full_time", basic: 4_000_000, allowances: 500_000 };
const raiseFromNovember: PayTerms = { effectiveFrom: "2026-11-01", employmentType: "full_time", basic: 4_400_000, allowances: 500_000 };

describe("payInForce", () => {
  it("uses the latest pay record on or before the month", () => {
    expect(payInForce([joining], OCTOBER)).toEqual(joining);
  });

  it("leaves this month unchanged when a pay change is dated next month", () => {
    const records = [joining, raiseFromNovember];
    expect(payInForce(records, OCTOBER)).toEqual(joining);
    expect(payInForce(records, NOVEMBER)).toEqual(raiseFromNovember);
    expect(payInForce(records, { year: 2027, month: 6 })).toEqual(raiseFromNovember);
  });

  it("does not depend on the order records arrive in", () => {
    expect(payInForce([raiseFromNovember, joining], OCTOBER)).toEqual(joining);
  });

  it("has no pay before the first record", () => {
    expect(payInForce([joining], { year: 2025, month: 2 })).toBeNull();
  });

  it("switches an intern to full-time from the month of the change", () => {
    const intern: PayTerms = { effectiveFrom: "2026-01-01", employmentType: "intern", stipend: 2_000_000 };
    const hired: PayTerms = { effectiveFrom: "2026-07-01", employmentType: "full_time", basic: 3_500_000, allowances: 0 };
    expect(payInForce([intern, hired], { year: 2026, month: 6 })?.employmentType).toBe("intern");
    expect(payInForce([intern, hired], { year: 2026, month: 7 })?.employmentType).toBe("full_time");
  });
});

describe("nextPayChange", () => {
  it("finds the change coming after this month", () => {
    expect(nextPayChange([joining, raiseFromNovember], OCTOBER)).toEqual(raiseFromNovember);
    expect(nextPayChange([joining, raiseFromNovember], NOVEMBER)).toBeNull();
  });
});

describe("regularPayOf", () => {
  it("feeds the payroll calculation for each type", () => {
    expect(regularPayOf(joining)).toEqual({ kind: "salary", basic: 4_000_000, allowances: 500_000 });
    expect(regularPayOf({ effectiveFrom: "2026-01-01", employmentType: "intern", stipend: 2_000_000 })).toEqual({
      kind: "stipend",
      stipend: 2_000_000,
    });
  });

  it("gives the take-home the payroll module calculates", () => {
    const terms = payInForce([joining, raiseFromNovember], OCTOBER);
    if (!terms) throw new Error("expected pay");
    const result = calculatePay(
      {
        employmentType: terms.employmentType,
        month: OCTOBER,
        regularPay: regularPayOf(terms),
        unpaidLeaveDays: 0,
        lines: [],
        recoveries: [],
      },
      resolveRules(V1_RULE_ROWS, terms.employmentType, OCTOBER),
    );
    expect(result.gross).toBe(4_500_000);
  });
});
