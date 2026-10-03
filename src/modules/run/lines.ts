import type { PayInput } from "@/modules/payroll";
import type { Chhertum } from "@/modules/rules/types";

// One-off lines on a person's pay for one month. Amounts are always positive; the kind says where
// the line goes: added to gross, taken off gross before tax, or taken off take-home after tax.

export const LINE_KINDS = ["arrear", "bonus", "other_earning", "leave_recovery", "advance_recovery", "other_deduction"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const LINE_SOURCES = ["manual", "exit_settlement", "correction"] as const;
export type LineSource = (typeof LINE_SOURCES)[number];

export type RunLine = {
  id: string;
  personId: string;
  kind: LineKind;
  amount: Chhertum;
  note: string;
  source: LineSource;
};

export type LineGroup = "earning" | "before_tax" | "after_tax";

export const LINE_GROUP: Record<LineKind, LineGroup> = {
  arrear: "earning",
  bonus: "earning",
  other_earning: "earning",
  leave_recovery: "before_tax",
  advance_recovery: "after_tax",
  other_deduction: "after_tax",
};

export const LINE_KIND_NAME: Record<LineKind, string> = {
  arrear: "Arrear",
  bonus: "Bonus",
  other_earning: "Other earning",
  leave_recovery: "Leave recovery",
  advance_recovery: "Advance recovery",
  other_deduction: "Other deduction",
};

/**
 * Lines as the payroll calculation takes them. A leave recovery lowers gross, so it is a negative
 * adjustment (HC and TDS fall with it); an other earning is a positive one. After-tax lines are recoveries.
 */
export function payInputLines(lines: readonly Pick<RunLine, "kind" | "amount" | "note">[]): Pick<PayInput, "lines" | "recoveries"> {
  const result: Pick<PayInput, "lines" | "recoveries"> = { lines: [], recoveries: [] };
  for (const line of lines) {
    switch (line.kind) {
      case "arrear":
      case "bonus":
        result.lines.push({ kind: line.kind, amount: line.amount, note: line.note });
        break;
      case "other_earning":
        result.lines.push({ kind: "adjustment", amount: line.amount, note: line.note });
        break;
      case "leave_recovery":
        result.lines.push({ kind: "adjustment", amount: -line.amount, note: line.note });
        break;
      case "advance_recovery":
      case "other_deduction":
        result.recoveries.push({ kind: line.kind, amount: line.amount, note: line.note });
        break;
    }
  }
  return result;
}

/** A person's payroll input with these lines in place of whatever it had. */
export function withLines(input: PayInput, lines: readonly Pick<RunLine, "kind" | "amount" | "note">[]): PayInput {
  return { ...input, ...payInputLines(lines) };
}
