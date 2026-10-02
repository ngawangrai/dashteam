import { parseNu } from "@/lib/format";
import { calculatePay } from "@/modules/payroll";
import type { Chhertum, EmploymentType, ResolvedRules } from "@/modules/rules/types";
import { type PayTerms, regularPayOf } from "./pay";

// Take-home for a full month with no leave, using the real payroll calculation and the rules in force.
// Shown while pay is typed so nobody has to work it out.

export type RulesByType = Record<EmploymentType, ResolvedRules>;

export function takeHomeFor(terms: PayTerms, rules: RulesByType): Chhertum | null {
  const rule = rules[terms.employmentType];
  try {
    return calculatePay(
      {
        employmentType: terms.employmentType,
        month: rule.month,
        regularPay: regularPayOf(terms),
        unpaidLeaveDays: 0,
        lines: [],
        recoveries: [],
      },
      rule,
    ).takeHome;
  } catch {
    return null;
  }
}

/** From what's typed in the pay fields, or null while it isn't a valid amount yet. */
export function termsFromFields(
  employmentType: EmploymentType,
  fields: { basic?: string; allowances?: string; stipend?: string },
): PayTerms | null {
  const effectiveFrom = "2000-01-01" as const;
  if (employmentType === "intern") {
    const stipend = parseNu(fields.stipend ?? "");
    return stipend && stipend > 0 ? { effectiveFrom, employmentType, stipend } : null;
  }
  const basic = parseNu(fields.basic ?? "");
  const allowances = fields.allowances?.trim() ? parseNu(fields.allowances) : 0;
  return basic && basic > 0 && allowances !== null ? { effectiveFrom, employmentType, basic, allowances } : null;
}
