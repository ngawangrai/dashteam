import { formatNu } from "@/lib/format";
import { calculatePay } from "@/modules/payroll";
import { resolveRules } from "@/modules/rules/resolve";
import type { Chhertum, EmploymentType, PayrollMonth, ResolvedRules, RuleRow } from "@/modules/rules/types";

// What DashTeam's own calculation would have made of an imported row, so differences show up before
// the import, as warnings. Imported figures are always kept exactly as given: this only informs.
// The row's own pay (already cut for any part month or unpaid leave) is treated as a full month,
// so the comparison is of the deductions on that gross, not of pro-rating.

export type ComparedFigures = {
  basic: Chhertum;
  allowance: Chhertum;
  stipend: Chhertum;
  arrear: Chhertum;
  otherEarnings: Chhertum;
  hc: Chhertum;
  pf: Chhertum;
  gis: Chhertum;
  tds: Chhertum;
  otherDeductions: Chhertum;
  takeHome: Chhertum;
};

export type ComparedField = "hc" | "pf" | "gis" | "tds" | "takeHome";
export type EngineDifference = { field: ComparedField; file: Chhertum; engine: Chhertum };
export type EngineComparison = { status: "no_rules" } | { status: "compared"; differences: EngineDifference[] };

export const COMPARED_FIELD_NAME: Record<ComparedField, string> = {
  hc: "health contribution",
  pf: "PF",
  gis: "GIS",
  tds: "TDS",
  takeHome: "take-home",
};

function rulesFor(ruleRows: readonly RuleRow[], employmentType: EmploymentType, month: PayrollMonth): ResolvedRules | null {
  try {
    return resolveRules(ruleRows, employmentType, month);
  } catch {
    // No rules in force that month (before DashTeam's first rules): nothing to compare against.
    return null;
  }
}

export function compareWithEngine(
  row: { month: PayrollMonth; employmentType: EmploymentType; figures: ComparedFigures },
  ruleRows: readonly RuleRow[],
): EngineComparison {
  const rules = rulesFor(ruleRows, row.employmentType, row.month);
  if (!rules) return { status: "no_rules" };
  const { figures } = row;
  const result = calculatePay(
    {
      employmentType: row.employmentType,
      month: row.month,
      regularPay: row.employmentType === "intern" ? { kind: "stipend", stipend: figures.stipend } : { kind: "salary", basic: figures.basic, allowances: figures.allowance },
      unpaidLeaveDays: 0,
      lines: [
        ...(figures.arrear ? [{ kind: "arrear" as const, amount: figures.arrear, note: "" }] : []),
        ...(figures.otherEarnings ? [{ kind: "bonus" as const, amount: figures.otherEarnings, note: "" }] : []),
      ],
      recoveries: figures.otherDeductions ? [{ kind: "other_deduction", amount: figures.otherDeductions, note: "" }] : [],
    },
    rules,
  );
  const engine: Record<ComparedField, Chhertum> = {
    hc: result.healthContribution,
    pf: result.providentFund,
    gis: result.gis,
    tds: result.tds,
    takeHome: result.takeHome,
  };
  const differences = (Object.keys(engine) as ComparedField[])
    .filter((field) => engine[field] !== figures[field])
    .map((field) => ({ field, file: figures[field], engine: engine[field] }));
  return { status: "compared", differences };
}

/** "TDS Nu. 6,130 (the file has Nu. 6,125) and take-home Nu. 58,220 (the file has Nu. 58,225)" */
export function describeDifferences(differences: readonly EngineDifference[]): string {
  const parts = differences.map((d) => `${COMPARED_FIELD_NAME[d.field]} ${formatNu(d.engine)} (the file has ${formatNu(d.file)})`);
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
