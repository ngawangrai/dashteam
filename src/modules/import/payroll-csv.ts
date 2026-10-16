import { formatDate, formatMonth, formatNu, parseNu } from "@/lib/format";
import type { Chhertum, EmploymentType, PayrollMonth, RuleRow } from "@/modules/rules/types";
import { monthFromKey, monthKey } from "@/modules/run/months";
import { compareWithEngine, describeDifferences } from "./compare";
import { CsvError, csvCell, parseCsv } from "./csv";

// Past payroll months from a CSV, checked in full before anything is saved. Pure: the file's text and
// what DashTeam already knows in, rows and every problem out. Errors block the import; warnings are
// shown and the figures are still kept exactly as given.

export const PAYROLL_IMPORT_COLUMNS = [
  "month",
  "email",
  "name",
  "employment_type",
  "basic",
  "allowance",
  "stipend",
  "arrear",
  "other_earnings",
  "gross",
  "pf",
  "gis",
  "tds",
  "hc",
  "other_deductions",
  "take_home",
] as const;

type Column = (typeof PAYROLL_IMPORT_COLUMNS)[number];

/** Columns the file must have. The others may be left out, and count as zero when they are. */
const REQUIRED_COLUMNS: readonly Column[] = ["month", "email", "name", "employment_type", "gross", "tds", "hc", "take_home"];

export const PAYROLL_IMPORT_MAX_BYTES = 1024 * 1024;

export type ImportPerson = { id: string; email: string; fullName: string; startDate: string; endDate: string | null };

export type PayrollImportContext = {
  /** DashTeam's first payroll month. Only months before it can be imported. */
  firstMonth: PayrollMonth | null;
  /** Months already locked or imported, as YYYY-MM. */
  takenMonths: readonly string[];
  people: readonly ImportPerson[];
  ruleRows: readonly RuleRow[];
};

export type ImportedFigures = {
  basic: Chhertum;
  allowance: Chhertum;
  stipend: Chhertum;
  arrear: Chhertum;
  otherEarnings: Chhertum;
  gross: Chhertum;
  pf: Chhertum;
  gis: Chhertum;
  tds: Chhertum;
  hc: Chhertum;
  otherDeductions: Chhertum;
  takeHome: Chhertum;
};

export type ImportRow = {
  line: number;
  month: PayrollMonth;
  monthKey: string;
  personId: string;
  fullName: string;
  employmentType: EmploymentType;
  figures: ImportedFigures;
  /** The row exactly as it was in the file, kept with the snapshot. */
  given: Record<string, string>;
};

export type ImportProblem = { line: number | null; message: string };

export type ImportMonthSummary = { month: PayrollMonth; monthKey: string; people: number; gross: Chhertum; tds: Chhertum; hc: Chhertum; takeHome: Chhertum };

export type PayrollImportCheck = { rows: ImportRow[]; errors: ImportProblem[]; warnings: ImportProblem[]; months: ImportMonthSummary[] };

const FIELD_OF: Record<Exclude<Column, "month" | "email" | "name" | "employment_type">, keyof ImportedFigures> = {
  basic: "basic",
  allowance: "allowance",
  stipend: "stipend",
  arrear: "arrear",
  other_earnings: "otherEarnings",
  gross: "gross",
  pf: "pf",
  gis: "gis",
  tds: "tds",
  hc: "hc",
  other_deductions: "otherDeductions",
  take_home: "takeHome",
};

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** "45,000", "45000.50", "Nu. 1,25,000" → chhertum. Blank is null; anything else is "invalid". */
function amountOf(text: string): Chhertum | null | "invalid" {
  const trimmed = text.trim().replace(/^nu\.?\s*/i, "");
  if (trimmed === "") return null;
  return parseNu(trimmed) ?? "invalid";
}

function lastDayOf(month: PayrollMonth): string {
  const day = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return `${monthKey(month)}-${String(day).padStart(2, "0")}`;
}

function employedIn(person: ImportPerson, month: PayrollMonth): boolean {
  return person.startDate <= lastDayOf(month) && (person.endDate === null || person.endDate >= `${monthKey(month)}-01`);
}

export function checkPayrollImport(text: string, context: PayrollImportContext): PayrollImportCheck {
  const errors: ImportProblem[] = [];
  const warnings: ImportProblem[] = [];
  const empty = (problem: string): PayrollImportCheck => ({ rows: [], errors: [{ line: null, message: problem }], warnings: [], months: [] });

  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (error) {
    return empty(error instanceof CsvError ? error.message : "This file couldn’t be read as a CSV.");
  }
  const [header, ...body] = parsed;
  if (!header) return empty("This file is empty. Start from the template.");
  if (!body.length) return empty("This file has headings but no rows yet.");

  const names = header.cells.map((cell) => cell.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((column) => !names.includes(column));
  const unknown = names.filter((name) => name && !(PAYROLL_IMPORT_COLUMNS as readonly string[]).includes(name));
  const repeated = names.filter((name, i) => name && names.indexOf(name) !== i);
  if (missing.length) errors.push({ line: 1, message: `The file needs ${missing.length === 1 ? "a column" : "columns"} called ${missing.join(", ")}. Start from the template.` });
  if (unknown.length) errors.push({ line: 1, message: `DashTeam doesn’t know ${unknown.length === 1 ? "the column" : "the columns"} ${unknown.join(", ")}. Check the spelling against the template.` });
  if (repeated.length) errors.push({ line: 1, message: `The column ${repeated[0]} appears twice.` });
  if (!context.firstMonth) errors.push({ line: null, message: "Choose DashTeam’s first payroll month on Payroll first. Only months before it can be brought in." });
  if (errors.length) return { rows: [], errors, warnings, months: [] };

  const byEmail = new Map(context.people.map((person) => [person.email.toLowerCase(), person]));
  const taken = new Set(context.takenMonths);
  const firstKey = context.firstMonth ? monthKey(context.firstMonth) : "";
  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();

  for (const { line, cells } of body) {
    const given: Record<string, string> = {};
    names.forEach((name, i) => {
      if (name) given[name] = (cells[i] ?? "").trim();
    });
    const at = (problem: string) => errors.push({ line, message: problem });
    const value = (column: Column) => given[column] ?? "";
    const before = errors.length;

    if (cells.length > names.length && cells.slice(names.length).some((cell) => cell.trim())) at("This row has more cells than there are headings.");

    const month = /^\d{4}-\d{2}$/.test(value("month")) ? monthFromKey(value("month")) : null;
    if (!month) at(value("month") ? `The month “${value("month")}” should look like 2026-03.` : "The month is blank.");
    else if (monthKey(month) >= firstKey) at(`${formatMonth(month, { withYear: true })} is on or after DashTeam’s first payroll month, so it’s paid in DashTeam, not brought in.`);
    else if (taken.has(monthKey(month))) at(`${formatMonth(month, { withYear: true })} is already in DashTeam.`);

    const email = value("email").toLowerCase();
    const person = email ? byEmail.get(email) : undefined;
    if (!email) at("The email is blank.");
    else if (!person) at(`Nobody in DashTeam has the email ${value("email")}. Add them on People first, including people who have left.`);
    else if (month && !employedIn(person, month)) {
      const when = person.startDate > lastDayOf(month) ? `started on ${formatDate(person.startDate)}` : `left on ${formatDate(person.endDate ?? "")}`;
      at(`${person.fullName} ${when}, so can’t be paid in ${formatMonth(month, { withYear: true })}. Fix their dates on People, or the row.`);
    }

    const type = value("employment_type");
    const employmentType: EmploymentType | null = type === "full_time" || type === "intern" ? type : null;
    if (!employmentType) at(type ? `The employment type “${type}” should be full_time or intern.` : "The employment type is blank.");

    const figures = {} as ImportedFigures;
    for (const [column, field] of Object.entries(FIELD_OF) as [keyof typeof FIELD_OF, keyof ImportedFigures][]) {
      const amount = amountOf(value(column));
      if (amount === "invalid") at(`${column} “${value(column)}” isn’t an amount. Use numbers like 45000 or 45,000.50.`);
      figures[field] = typeof amount === "number" ? amount : 0;
      const required = (REQUIRED_COLUMNS as readonly string[]).includes(column) || (column === "basic" && employmentType === "full_time") || (column === "stipend" && employmentType === "intern");
      if (amount === null && required) at(`${column} is blank.`);
    }
    if (employmentType === "full_time" && figures.stipend) at("A full-time row has no stipend. Put the pay in basic and allowance.");
    if (employmentType === "intern" && (figures.basic || figures.allowance)) at("An intern row is paid as a stipend. Put the pay in stipend, not basic or allowance.");

    if (errors.length === before) {
      const parts = figures.basic + figures.allowance + figures.stipend + figures.arrear + figures.otherEarnings;
      if (parts !== figures.gross) at(`Gross is ${formatNu(figures.gross)}, but its parts add up to ${formatNu(parts)}.`);
      const takeHome = figures.gross - figures.pf - figures.gis - figures.tds - figures.hc - figures.otherDeductions;
      if (takeHome !== figures.takeHome) at(`Take-home is ${formatNu(figures.takeHome)}, but gross minus deductions is ${formatNu(takeHome)}.`);
    }

    if (month && person) {
      const key = `${monthKey(month)}:${person.id}`;
      const earlier = seen.get(key);
      if (earlier !== undefined) at(`${person.fullName} already has a row for ${formatMonth(month, { withYear: true })} (row ${earlier}).`);
      else seen.set(key, line);
    }

    if (errors.length === before && month && person && employmentType) {
      if (!sameName(value("name"), person.fullName)) warnings.push({ line, message: `The name “${value("name")}” is ${person.fullName} in DashTeam. The row is matched by email.` });
      rows.push({ line, month, monthKey: monthKey(month), personId: person.id, fullName: person.fullName, employmentType, figures, given });
    }
  }

  // Compared with DashTeam's own calculation, row by row; months with no rules are noted once.
  const unruled = new Set<string>();
  for (const row of rows) {
    const comparison = compareWithEngine(row, context.ruleRows);
    if (comparison.status === "no_rules") unruled.add(row.monthKey);
    else if (comparison.differences.length) {
      warnings.push({
        line: row.line,
        message: `${row.fullName}, ${formatMonth(row.month, { withYear: true })}: DashTeam works out ${describeDifferences(comparison.differences)}. It’s brought in as given.`,
      });
    }
  }
  if (unruled.size) {
    const months = [...unruled].sort().map((key) => formatMonth(monthFromKey(key) ?? { year: 0, month: 1 }, { withYear: true }));
    warnings.push({ line: null, message: `DashTeam has no rules on file for ${listOf(months)}, so ${months.length === 1 ? "it isn’t" : "they aren’t"} compared with its own calculation.` });
  }

  // Someone employed in a month the file covers, with no row for it.
  const fileMonths = [...new Set(rows.map((row) => row.monthKey))].sort();
  for (const key of fileMonths) {
    const month = monthFromKey(key);
    if (!month) continue;
    for (const person of context.people) {
      if (employedIn(person, month) && !seen.has(`${key}:${person.id}`)) {
        warnings.push({ line: null, message: `${person.fullName} was employed in ${formatMonth(month, { withYear: true })} but has no row for it.` });
      }
    }
  }

  const months = errors.length ? [] : summarise(rows);
  return { rows: errors.length ? [] : rows, errors, warnings, months };
}

function summarise(rows: readonly ImportRow[]): ImportMonthSummary[] {
  const byMonth = new Map<string, ImportMonthSummary>();
  for (const row of rows) {
    const summary = byMonth.get(row.monthKey) ?? { month: row.month, monthKey: row.monthKey, people: 0, gross: 0, tds: 0, hc: 0, takeHome: 0 };
    summary.people += 1;
    summary.gross += row.figures.gross;
    summary.tds += row.figures.tds;
    summary.hc += row.figures.hc;
    summary.takeHome += row.figures.takeHome;
    byMonth.set(row.monthKey, summary);
  }
  return [...byMonth.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function listOf(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The template: headings, then one example row for each employment type, to be replaced. */
export function payrollImportTemplate(): string {
  const rows: string[][] = [
    [...PAYROLL_IMPORT_COLUMNS],
    ["2026-03", "sonam@example.bt", "Sonam Wangmo", "full_time", "40000", "5000", "", "", "", "45000", "", "", "2583", "450", "", "41967"],
    ["2026-03", "dechen@example.bt", "Dechen Lhamo", "intern", "", "", "20000", "", "", "20000", "", "", "0", "200", "", "19800"],
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
