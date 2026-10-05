import { parseRuleValue } from "./schema";
import {
  type EmploymentType,
  LEAVE_RULE_KEYS,
  type LeaveRuleValues,
  PAYROLL_RULE_KEYS,
  type PayrollMonth,
  type PayrollRuleValues,
  type PayrollSettings,
  type CompanyDetails,
  type SettingsRuleKey,
  type SettingsRuleValues,
  type ResolvedLeaveRules,
  type ResolvedRules,
  type RuleKey,
  type RuleRow,
  type RuleValues,
} from "./types";

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function firstOfMonth({ year, month }: PayrollMonth): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Not a payroll month: ${year}-${month}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/**
 * For each key, the row for this employment type with the latest effective_from on or before the
 * first of the month. A missing rule is an error, never a default.
 */
function rulesInForce<K extends RuleKey>(
  rows: readonly RuleRow[],
  keys: readonly K[],
  employmentType: EmploymentType,
  month: PayrollMonth,
): { values: Pick<RuleValues, K>; ruleIds: string[] } {
  const monthStart = firstOfMonth(month);

  for (const row of rows) {
    const match = PLAIN_DATE.exec(row.effectiveFrom);
    if (!match || match[3] !== "01") {
      throw new Error(`Rule ${row.id} must start on the first of a month, not ${row.effectiveFrom}`);
    }
  }

  const ruleIds: string[] = [];
  const entries = keys.map((key) => {
    // ISO dates compare correctly as strings.
    const row = rows
      .filter((r) => r.key === key && r.employmentType === employmentType && r.effectiveFrom <= monthStart)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
    if (!row) throw new Error(`No ${key} rule for ${employmentType} in force on ${monthStart}`);
    ruleIds.push(row.id);
    return [key, parseRuleValue(key, row.value)] as const;
  });
  return { values: Object.fromEntries(entries) as Pick<RuleValues, K>, ruleIds };
}

/** The payroll rules in force for one employment type in one payroll month. */
export function resolveRules(rows: readonly RuleRow[], employmentType: EmploymentType, month: PayrollMonth): ResolvedRules {
  const { values, ruleIds } = rulesInForce(rows, PAYROLL_RULE_KEYS, employmentType, month);
  const v = values as PayrollRuleValues;
  return {
    employmentType,
    month: { ...month },
    tds: v.tds,
    healthContribution: v.health_contribution,
    providentFund: v.provident_fund,
    gis: v.gis,
    proration: v.proration,
    it1aInclusion: v.it1a_inclusion,
    ruleIds,
  };
}

/** The leave rules in force for one employment type in one month. */
export function resolveLeaveRules(rows: readonly RuleRow[], employmentType: EmploymentType, month: PayrollMonth): ResolvedLeaveRules {
  const { values, ruleIds } = rulesInForce(rows, LEAVE_RULE_KEYS, employmentType, month);
  const v = values as LeaveRuleValues;
  return {
    employmentType,
    month: { ...month },
    policy: v.leave_policy,
    carryForward: v.leave_carry_forward,
    workingWeek: v.working_week.days,
    prorationCutoffDay: v.proration_cutoff.day,
    backdateMonths: v.leave_backdate.months,
    exitPayout: v.leave_exit_payout,
    ruleIds,
  };
}

/** A company-wide setting: stored for both employment types and written together, so the two must agree. */
function companyWide<K extends SettingsRuleKey>(rows: readonly RuleRow[], key: K, month: PayrollMonth): SettingsRuleValues[K] & { ruleIds: string[] } {
  const fullTime = rulesInForce(rows, [key], "full_time", month);
  const intern = rulesInForce(rows, [key], "intern", month);
  const value = fullTime.values[key] as SettingsRuleValues[K];
  if (JSON.stringify(value) !== JSON.stringify(intern.values[key])) {
    throw new Error(`The ${key} rules differ between employment types`);
  }
  return { ...value, ruleIds: [...fullTime.ruleIds, ...intern.ruleIds] };
}

/** Payroll settings in force for a month. */
export function resolvePayrollSettings(rows: readonly RuleRow[], month: PayrollMonth): PayrollSettings {
  return companyWide(rows, "payroll_settings", month);
}

/** The company's name, address and logo as documents for this month show them. */
export function resolveCompanyDetails(rows: readonly RuleRow[], month: PayrollMonth): CompanyDetails {
  return companyWide(rows, "company_details", month);
}
