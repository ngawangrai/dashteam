import type { PayInput } from "@/modules/payroll";
import type { Chhertum, EmploymentType, PayrollMonth, PlainDate } from "@/modules/rules/types";

// A person's employment terms are dated records: each starts on the 1st of a month and stays
// in force until the next one. A raise or a change of type is a new record, never an edit.

export type PayTerms =
  | { effectiveFrom: PlainDate; employmentType: Extract<EmploymentType, "full_time">; basic: Chhertum; allowances: Chhertum }
  | { effectiveFrom: PlainDate; employmentType: Extract<EmploymentType, "intern">; stipend: Chhertum };

const monthStart = ({ year, month }: PayrollMonth) => `${year}-${String(month).padStart(2, "0")}-01`;

const newestFirst = (records: readonly PayTerms[]) =>
  [...records].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));

/** The terms in force for a payroll month, or null before the first record. */
export function payInForce(records: readonly PayTerms[], month: PayrollMonth): PayTerms | null {
  const start = monthStart(month);
  return newestFirst(records).find((record) => record.effectiveFrom <= start) ?? null;
}

/** The first change that starts after this month, if one is already recorded. */
export function nextPayChange(records: readonly PayTerms[], month: PayrollMonth): PayTerms | null {
  const start = monthStart(month);
  return [...newestFirst(records)].reverse().find((record) => record.effectiveFrom > start) ?? null;
}

export function regularPayOf(terms: PayTerms): PayInput["regularPay"] {
  return terms.employmentType === "intern"
    ? { kind: "stipend", stipend: terms.stipend }
    : { kind: "salary", basic: terms.basic, allowances: terms.allowances };
}

export function monthlyPayOf(terms: PayTerms): Chhertum {
  return terms.employmentType === "intern" ? terms.stipend : terms.basic + terms.allowances;
}
