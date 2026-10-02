import { parseRuleValue } from "./schema";
import { type EmploymentType, type PayrollMonth, type ResolvedRules, RULE_KEYS, type RuleKey, type RuleRow, type RuleValues } from "./types";

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function firstOfMonth({ year, month }: PayrollMonth): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Not a payroll month: ${year}-${month}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/**
 * The rules in force for one employment type in one payroll month: for each key,
 * the row with the latest effective_from on or before the first of the month.
 * A missing rule is an error, never a default.
 */
export function resolveRules(rows: readonly RuleRow[], employmentType: EmploymentType, month: PayrollMonth): ResolvedRules {
  const monthStart = firstOfMonth(month);

  for (const row of rows) {
    const match = PLAIN_DATE.exec(row.effectiveFrom);
    if (!match || match[3] !== "01") {
      throw new Error(`Rule ${row.id} must start on the first of a month, not ${row.effectiveFrom}`);
    }
  }

  const ruleIds: string[] = [];
  function inForce<K extends RuleKey>(key: K): RuleValues[K] {
    // ISO dates compare correctly as strings.
    const row = rows
      .filter((r) => r.key === key && r.employmentType === employmentType && r.effectiveFrom <= monthStart)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
    if (!row) throw new Error(`No ${key} rule for ${employmentType} in force on ${monthStart}`);
    ruleIds.push(row.id);
    return parseRuleValue(key, row.value);
  }

  const values = Object.fromEntries(RULE_KEYS.map((key) => [key, inForce(key)])) as RuleValues;

  return {
    employmentType,
    month: { ...month },
    tds: values.tds,
    healthContribution: values.health_contribution,
    providentFund: values.provident_fund,
    gis: values.gis,
    proration: values.proration,
    it1aInclusion: values.it1a_inclusion,
    ruleIds,
  };
}
