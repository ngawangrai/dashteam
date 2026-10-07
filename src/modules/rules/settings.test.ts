import { describe, expect, it } from "vitest";
import { resolveCompanyDetails, resolveFilingSettings, resolvePayrollSettings } from "./resolve";
import type { RuleRow } from "./types";
import { V1_COMPANY_RULE_ROWS, V1_FILING_RULE_ROWS, V1_RULE_ROWS, V1_SETTINGS_RULE_ROWS } from "./v1";

// Payroll settings are company-wide, but rules attach to an employment type, so they are stored for
// both types and always written together.

const october = { year: 2026, month: 10 };
const rows = [...V1_RULE_ROWS, ...V1_SETTINGS_RULE_ROWS];

const setting = (employmentType: "full_time" | "intern", effectiveFrom: string, value: unknown): RuleRow => ({
  id: `test:settings:${employmentType}:${effectiveFrom}`,
  key: "payroll_settings",
  employmentType,
  effectiveFrom: effectiveFrom as RuleRow["effectiveFrom"],
  value,
});

const both = (effectiveFrom: string, value: unknown) => [setting("full_time", effectiveFrom, value), setting("intern", effectiveFrom, value)];

describe("payroll settings", () => {
  it("start with no first month, a 10% large-change line and the 10th as the due day", () => {
    expect(resolvePayrollSettings(rows, october)).toMatchObject({ firstMonth: null, largeChange: 1_000, dueDay: 10 });
  });

  it("take the first month from the row in force", () => {
    const set = [...rows, ...both("2026-10-01", { first_month: "2026-09-01", large_change_bp: 1_000, due_day: 10 })];
    expect(resolvePayrollSettings(set, october).firstMonth).toEqual({ year: 2026, month: 9 });
    // Earlier months still read the earlier row.
    expect(resolvePayrollSettings(set, { year: 2026, month: 9 }).firstMonth).toBeNull();
  });

  it("record both rows as the rules version", () => {
    expect(resolvePayrollSettings(rows, october).ruleIds).toEqual(["v1:payroll_settings:full_time", "v1:payroll_settings:intern"]);
  });

  it("refuse settings that differ between employment types", () => {
    const split = [...rows, setting("full_time", "2026-10-01", { first_month: null, large_change_bp: 2_000, due_day: 10 })];
    expect(() => resolvePayrollSettings(split, october)).toThrow(/differ/);
  });

  it.each([
    ["a first month that isn't the 1st", { first_month: "2026-09-15", large_change_bp: 1_000, due_day: 10 }],
    ["a due day past the 28th", { first_month: null, large_change_bp: 1_000, due_day: 31 }],
    ["a negative threshold", { first_month: null, large_change_bp: -1, due_day: 10 }],
    ["an unknown field", { first_month: null, large_change_bp: 1_000, due_day: 10, extra: true }],
  ])("refuse %s", (_label, value) => {
    expect(() => resolvePayrollSettings([...rows, ...both("2026-10-01", value)], october)).toThrow();
  });

  it("are an error, never a default, when missing", () => {
    expect(() => resolvePayrollSettings(V1_RULE_ROWS, october)).toThrow(/No payroll_settings rule/);
  });
});

describe("company details", () => {
  const withCompany = [...rows, ...V1_COMPANY_RULE_ROWS];

  it("start as Xceed Studio with no address and no logo", () => {
    expect(resolveCompanyDetails(withCompany, october)).toMatchObject({ name: "Xceed Studio", addressLines: [], showLogo: false });
  });

  it("take an address added later from its month, leaving earlier months as they were", () => {
    const value = { name: "Xceed Studio", address_lines: ["Norzin Lam", "Thimphu"], show_logo: true };
    const later = [...withCompany, ...(["full_time", "intern"] as const).map((employmentType) => ({ ...setting(employmentType, "2026-11-01", value), key: "company_details" as const }))];
    expect(resolveCompanyDetails(later, { year: 2026, month: 11 })).toMatchObject({ addressLines: ["Norzin Lam", "Thimphu"], showLogo: true });
    expect(resolveCompanyDetails(later, october).addressLines).toEqual([]);
  });

  it("refuse a blank name", () => {
    const blank = [...rows, ...(["full_time", "intern"] as const).map((employmentType) => ({ ...setting(employmentType, "2026-01-01", { name: " ", address_lines: [], show_logo: false }), key: "company_details" as const }))];
    expect(() => resolveCompanyDetails(blank, october)).toThrow();
  });
});

describe("filing settings", () => {
  const withFiling = [...rows, ...V1_FILING_RULE_ROWS];

  it("start with reminders on the 5th, 8th and 10th", () => {
    expect(resolveFilingSettings(withFiling, october)).toMatchObject({ reminderDays: [5, 8, 10] });
  });

  it.each([
    ["no days at all", { reminder_days: [] }],
    ["a day past the 28th", { reminder_days: [5, 31] }],
    ["the same day twice", { reminder_days: [5, 5] }],
  ])("refuse %s", (_label, value) => {
    const bad = [...rows, ...(["full_time", "intern"] as const).map((employmentType) => ({ ...setting(employmentType, "2026-01-01", value), key: "filing_settings" as const }))];
    expect(() => resolveFilingSettings(bad, october)).toThrow();
  });
});
