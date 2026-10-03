import { addMonths, monthOf } from "@/lib/format";
import type { PayrollMonth } from "@/modules/rules/types";
import { V1_EFFECTIVE_FROM } from "@/modules/rules/v1";
import { monthIndex } from "./build";

/** "2026-10" for a month, as used in payroll URLs. */
export const monthKey = ({ year, month }: PayrollMonth) => `${year}-${String(month).padStart(2, "0")}`;

/** "2026-10" → that month, or null for anything else. */
export function monthFromKey(key: string): PayrollMonth | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? monthOf(`${key}-01`) : null;
}

/** The months the first payroll month can be: from when the V1 rules start to next month. */
export function firstMonthChoices(thisMonth: PayrollMonth): PayrollMonth[] {
  const choices: PayrollMonth[] = [];
  for (let m = monthOf(V1_EFFECTIVE_FROM); monthIndex(m) <= monthIndex(addMonths(thisMonth, 1)); m = addMonths(m, 1)) choices.push(m);
  return choices;
}
