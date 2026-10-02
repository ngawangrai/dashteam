import { describe, expect, it } from "vitest";
import { resolveRules } from "./resolve";
import { parseRuleValue } from "./schema";
import type { RuleRow } from "./types";
import { V1_RULE_ROWS } from "./v1";

const october2026 = { year: 2026, month: 10 };

function withRow(row: Omit<RuleRow, "id"> & { id?: string }): RuleRow[] {
  return [...V1_RULE_ROWS, { id: row.id ?? `test:${row.key}:${row.effectiveFrom}`, ...row }];
}

describe("resolveRules", () => {
  it("resolves every V1 rule for both employment types", () => {
    for (const type of ["full_time", "intern"] as const) {
      const rules = resolveRules(V1_RULE_ROWS, type, october2026);
      expect(rules.employmentType).toBe(type);
      expect(rules.healthContribution).toEqual({ enabled: true, rate: 100, roundTo: 100, rounding: "nearest" });
      expect(rules.providentFund).toEqual({ enabled: false });
      expect(rules.tds.bands).toHaveLength(6);
      expect(rules.ruleIds).toHaveLength(6);
    }
  });

  it("uses the latest rule in force on the first of the month", () => {
    const rows = withRow({
      key: "health_contribution",
      employmentType: "full_time",
      effectiveFrom: "2026-07-01",
      value: { enabled: true, rate_bp: 150, round_to_ch: 100, rounding: "up" },
    });
    expect(resolveRules(rows, "full_time", { year: 2026, month: 7 }).healthContribution.rate).toBe(150);
    expect(resolveRules(rows, "full_time", { year: 2026, month: 12 }).healthContribution.rate).toBe(150);
  });

  it("never lets a later rule change an earlier month", () => {
    const rows = withRow({
      key: "health_contribution",
      employmentType: "full_time",
      effectiveFrom: "2026-11-01",
      value: { enabled: true, rate_bp: 200, round_to_ch: 100, rounding: "nearest" },
    });
    expect(resolveRules(rows, "full_time", october2026)).toEqual(resolveRules(V1_RULE_ROWS, "full_time", october2026));
  });

  it("ignores rules for the other employment type", () => {
    const rows = withRow({
      key: "health_contribution",
      employmentType: "intern",
      effectiveFrom: "2026-07-01",
      value: { enabled: false, rate_bp: 100, round_to_ch: 100, rounding: "nearest" },
    });
    expect(resolveRules(rows, "full_time", october2026).healthContribution.enabled).toBe(true);
    expect(resolveRules(rows, "intern", october2026).healthContribution.enabled).toBe(false);
  });

  it("records the ids of the rows it used", () => {
    const rows = withRow({
      id: "hc-from-july",
      key: "health_contribution",
      employmentType: "full_time",
      effectiveFrom: "2026-07-01",
      value: { enabled: true, rate_bp: 100, round_to_ch: 100, rounding: "down" },
    });
    const { ruleIds } = resolveRules(rows, "full_time", october2026);
    expect(ruleIds).toContain("hc-from-july");
    expect(ruleIds).not.toContain("v1:health_contribution:full_time");
  });

  it("refuses a month before any rule is in force, with no silent defaults", () => {
    expect(() => resolveRules(V1_RULE_ROWS, "full_time", { year: 2025, month: 12 })).toThrow(/no tds rule/i);
  });

  it("refuses a missing rule", () => {
    const rows = V1_RULE_ROWS.filter((row) => !(row.key === "gis" && row.employmentType === "intern"));
    expect(() => resolveRules(rows, "intern", october2026)).toThrow(/no gis rule/i);
  });

  it("refuses a rule that does not start on the first of a month", () => {
    const rows = withRow({ key: "gis", employmentType: "full_time", effectiveFrom: "2026-07-15", value: { amount_ch: 0 } });
    expect(() => resolveRules(rows, "full_time", october2026)).toThrow(/first of a month/i);
  });

  it("refuses an invalid month", () => {
    expect(() => resolveRules(V1_RULE_ROWS, "full_time", { year: 2026, month: 13 })).toThrow();
  });
});

describe("rule values", () => {
  it.each(["nearest", "down", "up"])("accepts HC rounding %s", (rounding) => {
    expect(parseRuleValue("health_contribution", { enabled: true, rate_bp: 100, round_to_ch: 100, rounding })).toMatchObject({
      rounding,
    });
  });

  it("rejects an unknown rounding mode", () => {
    expect(() =>
      parseRuleValue("health_contribution", { enabled: true, rate_bp: 100, round_to_ch: 100, rounding: "bankers" }),
    ).toThrow();
  });

  it("rejects a fractional rate or amount", () => {
    expect(() => parseRuleValue("health_contribution", { enabled: true, rate_bp: 1.5, round_to_ch: 100, rounding: "up" })).toThrow();
    expect(() => parseRuleValue("gis", { amount_ch: 0.5 })).toThrow();
  });

  it("refuses to switch PF on without a rate and a rounding rule", () => {
    expect(() => parseRuleValue("provident_fund", { enabled: true })).toThrow();
    expect(() => parseRuleValue("provident_fund", { enabled: true, employee_rate_bp: 1_000 })).toThrow();
    expect(parseRuleValue("provident_fund", { enabled: true, employee_rate_bp: 1_000, round_to_ch: 100, rounding: "nearest" })).toEqual({
      enabled: true,
      employeeRate: 1_000,
      roundTo: 100,
      rounding: "nearest",
    });
  });

  it("requires TDS bands to start at zero and rise", () => {
    const base = { months_per_year: 12, taxable_round_up_to_ch: 10_000, result_round_to_ch: 100, result_rounding: "nearest" };
    expect(() => parseRuleValue("tds", { ...base, bands: [{ from_annual_ch: 100, rate_bp: 0 }] })).toThrow();
    expect(() =>
      parseRuleValue("tds", {
        ...base,
        bands: [
          { from_annual_ch: 0, rate_bp: 0 },
          { from_annual_ch: 500, rate_bp: 1_000 },
          { from_annual_ch: 400, rate_bp: 1_500 },
        ],
      }),
    ).toThrow();
  });

  it("rejects a rate above 100%", () => {
    expect(() => parseRuleValue("health_contribution", { enabled: true, rate_bp: 10_001, round_to_ch: 100, rounding: "up" })).toThrow();
  });
});
