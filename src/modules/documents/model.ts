import { formatDays, formatLongDate, formatMonth } from "@/lib/format";
import type { PayInput, PayResult } from "@/modules/payroll";
import type { PayTerms } from "@/modules/people/pay";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";
import type { Chhertum, CompanyDetails, EmploymentType, PayrollMonth } from "@/modules/rules/types";
import { LINE_GROUP, LINE_KIND_NAME, type RunLine } from "@/modules/run/lines";

// What a payslip says, worked out from the locked snapshot and nothing else. The same model is printed
// to the PDF and shown in the app, so the two can never disagree. Pure: snapshot in, payslip out.

/** The parts of a payroll snapshot a payslip reads (see payroll_snapshots and lockPayroll). */
export type PayslipSnapshot = {
  month: PayrollMonth;
  fullName: string;
  employmentType: EmploymentType;
  person: { tpnLast4: string | null };
  inputs: { terms: PayTerms | null; startDate: string; endDate: string | null; unpaidLeaveDays: number; lines: RunLine[]; payInput: PayInput };
  result: PayResult;
};

/** What an imported month's snapshot holds: the figures exactly as they were given, nothing worked out. */
export type ImportedComponents = {
  basic: Chhertum;
  allowance: Chhertum;
  stipend: Chhertum;
  arrear: Chhertum;
  otherEarnings: Chhertum;
  otherDeductions: Chhertum;
};
export type ImportedInputs = { kind: "imported"; components: ImportedComponents; given: Record<string, string> };

/** A snapshot from a month brought in from before DashTeam. Its result is the file's figures. */
export type ImportedPayslipSnapshot = Omit<PayslipSnapshot, "inputs"> & { inputs: ImportedInputs };

export function isImportedInputs(inputs: unknown): inputs is ImportedInputs {
  return typeof inputs === "object" && inputs !== null && (inputs as { kind?: unknown }).kind === "imported";
}

export type PayslipRow = { label: string; detail?: string; amount: Chhertum };

export type PayslipModel = {
  company: { name: string; addressLines: string[]; showLogo: boolean };
  title: string;
  monthName: string;
  person: { name: string; employmentType: string; tpn: string };
  takeHome: Chhertum;
  /** Regular pay, then earnings, then any leave recovery as a negative amount. They add up to gross. */
  earnings: PayslipRow[];
  gross: Chhertum;
  /** HC, PF and GIS when taken, TDS, then after-tax recoveries. They add up to the total. */
  deductions: PayslipRow[];
  totalDeductions: Chhertum;
  reference: string;
  issuedOn: string;
  /** Who to ask if something looks wrong: the admin who locked the month. Used in the email, not printed. */
  contact: string;
  /** Brought in from records kept before DashTeam. Absent on payslips DashTeam worked out. */
  imported?: true;
};

/** The company's mark on every payslip reference. A format, not a setting. */
const REFERENCE_PREFIX = "XS";

/** XS-202610-007: the month, then the person's place in that month's payslips. */
export function payslipReference({ year, month }: PayrollMonth, position: number): string {
  return `${REFERENCE_PREFIX}-${year}${String(month).padStart(2, "0")}-${String(position).padStart(3, "0")}`;
}

function regularPay(snapshot: PayslipSnapshot): PayslipRow[] {
  const { result, inputs } = snapshot;
  const terms = inputs.terms;
  const partMonth = result.daysPaid < result.daysInMonth;
  const unpaid = inputs.unpaidLeaveDays > 0 ? ` (${formatDays(inputs.unpaidLeaveDays)} unpaid)` : "";
  const detail = partMonth ? `${result.daysPaid} of ${result.daysInMonth} days${unpaid}` : undefined;

  if (snapshot.employmentType === "intern") {
    return [{ label: "Stipend", ...(detail ? { detail } : {}), amount: result.regularPayDue }];
  }
  // A full month is never pro-rated, so basic and allowances are shown as they are. A part month is one
  // pro-rated amount: splitting it would need rounding the calculation never did.
  if (!partMonth && terms?.employmentType === "full_time" && terms.basic + terms.allowances === result.regularPayDue) {
    return [
      { label: "Basic", amount: terms.basic },
      ...(terms.allowances ? [{ label: "Allowances", amount: terms.allowances }] : []),
    ];
  }
  return [{ label: "Basic and allowances", ...(detail ? { detail } : {}), amount: result.regularPayDue }];
}

const lineRow = (line: RunLine, sign: 1 | -1): PayslipRow => ({ label: LINE_KIND_NAME[line.kind], ...(line.note ? { detail: line.note } : {}), amount: sign * line.amount });

export function payslipModel(snapshot: PayslipSnapshot, company: CompanyDetails, reference: string, issuedOn: string, contact = "your admin"): PayslipModel {
  const { result, inputs } = snapshot;
  const earnings: PayslipRow[] = [
    ...regularPay(snapshot),
    ...inputs.lines.filter((line) => LINE_GROUP[line.kind] === "earning").map((line) => lineRow(line, 1)),
    ...inputs.lines.filter((line) => LINE_GROUP[line.kind] === "before_tax").map((line) => lineRow(line, -1)),
  ];
  const deductions: PayslipRow[] = [
    { label: "Health contribution", amount: result.healthContribution },
    ...(result.providentFund ? [{ label: "Provident fund", amount: result.providentFund }] : []),
    ...(result.gis ? [{ label: "GIS", amount: result.gis }] : []),
    { label: "TDS", amount: result.tds },
    ...inputs.lines.filter((line) => LINE_GROUP[line.kind] === "after_tax").map((line) => lineRow(line, 1)),
  ];
  const monthName = formatMonth(snapshot.month, { withYear: true });
  return {
    company: { name: company.name, addressLines: company.addressLines, showLogo: company.showLogo },
    title: `Payslip · ${monthName}`,
    monthName,
    person: {
      name: snapshot.fullName,
      employmentType: EMPLOYMENT_TYPE_LABEL[snapshot.employmentType],
      tpn: snapshot.person.tpnLast4 ? `TPN ••••${snapshot.person.tpnLast4}` : "TPN not on file",
    },
    takeHome: result.takeHome,
    earnings,
    gross: result.gross,
    deductions,
    totalDeductions: result.gross - result.takeHome,
    reference,
    issuedOn: formatLongDate(issuedOn),
    contact,
  };
}

/**
 * A payslip for a month brought in from before DashTeam: the figures exactly as given, in the same
 * layout, marked as imported. Rows that are zero are left out, as on any payslip.
 */
export function importedPayslipModel(snapshot: ImportedPayslipSnapshot, company: CompanyDetails, reference: string, issuedOn: string, contact = "your admin"): PayslipModel {
  const { result } = snapshot;
  const parts = snapshot.inputs.components;
  const row = (label: string, amount: Chhertum): PayslipRow[] => (amount ? [{ label, amount }] : []);
  const earnings: PayslipRow[] =
    snapshot.employmentType === "intern"
      ? [{ label: "Stipend", amount: parts.stipend }]
      : [{ label: "Basic", amount: parts.basic }, ...row("Allowances", parts.allowance)];
  earnings.push(...row("Arrear", parts.arrear), ...row("Other earnings", parts.otherEarnings));
  const deductions: PayslipRow[] = [
    { label: "Health contribution", amount: result.healthContribution },
    ...row("Provident fund", result.providentFund),
    ...row("GIS", result.gis),
    { label: "TDS", amount: result.tds },
    ...row("Other deductions", parts.otherDeductions),
  ];
  const monthName = formatMonth(snapshot.month, { withYear: true });
  return {
    company: { name: company.name, addressLines: company.addressLines, showLogo: company.showLogo },
    title: `Payslip · ${monthName}`,
    monthName,
    person: {
      name: snapshot.fullName,
      employmentType: EMPLOYMENT_TYPE_LABEL[snapshot.employmentType],
      tpn: snapshot.person.tpnLast4 ? `TPN ••••${snapshot.person.tpnLast4}` : "TPN not on file",
    },
    takeHome: result.takeHome,
    earnings,
    gross: result.gross,
    deductions,
    totalDeductions: result.gross - result.takeHome,
    reference,
    issuedOn: formatLongDate(issuedOn),
    contact,
    imported: true,
  };
}
