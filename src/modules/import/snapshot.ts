import type { ImportedInputs } from "@/modules/documents/model";
import type { PayResult } from "@/modules/payroll";
import type { ImportRow } from "./payroll-csv";

// What an imported row becomes in payroll_snapshots: the given figures, in the same shape a locked
// month stores, so payslips and statements read it the same way. Nothing is worked out here; the
// only sums are the ones the file was already checked to satisfy.

export function importedSnapshot(row: ImportRow): { inputs: ImportedInputs; result: PayResult } {
  const f = row.figures;
  const daysInMonth = new Date(Date.UTC(row.month.year, row.month.month, 0)).getUTCDate();
  const taxable = f.gross - f.pf - f.gis;
  return {
    inputs: {
      kind: "imported",
      components: { basic: f.basic, allowance: f.allowance, stipend: f.stipend, arrear: f.arrear, otherEarnings: f.otherEarnings, otherDeductions: f.otherDeductions },
      given: row.given,
    },
    result: {
      // Days aren't known for a month paid outside DashTeam; the pay given is what was paid.
      daysInMonth,
      daysPaid: daysInMonth,
      regularPayDue: f.basic + f.allowance + f.stipend,
      gross: f.gross,
      healthContribution: f.hc,
      providentFund: f.pf,
      gis: f.gis,
      taxable,
      taxableForTds: taxable,
      tds: f.tds,
      recoveries: f.otherDeductions,
      takeHome: f.takeHome,
      ruleIds: [],
    },
  };
}
