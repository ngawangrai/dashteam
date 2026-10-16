import { describe, expect, it } from "vitest";
import { RULES, nu } from "../../../tests/support/mixed-team";
import { compareWithEngine } from "./compare";
import { parseCsv } from "./csv";
import { type ImportPerson, PAYROLL_IMPORT_COLUMNS, type PayrollImportContext, checkPayrollImport, payrollImportTemplate } from "./payroll-csv";

// Past months come in only when the whole file is right. Every problem is listed with its row, and
// differences from DashTeam's own calculation are warnings: the figures are kept as given.

const KARMA: ImportPerson = { id: "karma", email: "karma@xceed.studio", fullName: "Karma Wangchuk", startDate: "2025-02-03", endDate: null };
const DECHEN: ImportPerson = { id: "dechen", email: "dechen@xceed.studio", fullName: "Dechen Lhamo", startDate: "2026-06-01", endDate: null };
const TSHERING: ImportPerson = { id: "tshering", email: "tshering@xceed.studio", fullName: "Tshering Dorji", startDate: "2024-08-05", endDate: "2026-09-20" };

const CONTEXT: PayrollImportContext = {
  firstMonth: { year: 2026, month: 11 },
  takenMonths: [],
  people: [KARMA, DECHEN],
  ruleRows: RULES,
};

const HEADER = PAYROLL_IMPORT_COLUMNS.join(",");
// October 2026, worked out by DashTeam (milestone 4): Karma with a 5,000 arrear and a 3,000 advance recovery.
const KARMA_OCTOBER = "2026-10,karma@xceed.studio,Karma Wangchuk,full_time,50000,10000,,5000,,65000,,,6125,650,3000,55225";
const DECHEN_OCTOBER = "2026-10,dechen@xceed.studio,Dechen Lhamo,intern,,,20000,,,20000,,,0,200,,19800";

const file = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";
const check = (text: string, context: Partial<PayrollImportContext> = {}) => checkPayrollImport(text, { ...CONTEXT, ...context });
const messages = (problems: { line: number | null; message: string }[]) => problems.map((p) => `${p.line ?? "-"}: ${p.message}`);

describe("a file that's right", () => {
  const result = check(file(KARMA_OCTOBER, DECHEN_OCTOBER));

  it("has no errors and no warnings when it matches DashTeam's own calculation", () => {
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps every figure exactly as given, in chhertum", () => {
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      line: 2,
      monthKey: "2026-10",
      personId: "karma",
      employmentType: "full_time",
      figures: { basic: nu(50_000), allowance: nu(10_000), stipend: 0, arrear: nu(5_000), otherEarnings: 0, gross: nu(65_000), pf: 0, gis: 0, tds: nu(6_125), hc: nu(650), otherDeductions: nu(3_000), takeHome: nu(55_225) },
    });
    expect(result.rows[0]?.given.take_home).toBe("55225");
  });

  it("sums each month for the preview", () => {
    expect(result.months).toEqual([{ month: { year: 2026, month: 10 }, monthKey: "2026-10", people: 2, gross: nu(85_000), tds: nu(6_125), hc: nu(850), takeHome: nu(75_025) }]);
  });

  it("reads amounts the way spreadsheets write them", () => {
    const formatted = check(file('2026-10,karma@xceed.studio,Karma Wangchuk,full_time,"50,000",Nu. 10000,,"Nu. 5,000.00",,"65,000",,,6125,650,3000,"55,225"'));
    expect(formatted.errors).toEqual([]);
    expect(formatted.rows[0]?.figures.gross).toBe(nu(65_000));
  });

  it("reads Excel's byte-order mark, LF endings, any column order, and optional columns left out", () => {
    const columns = ["take_home", "hc", "tds", "gross", "employment_type", "name", "email", "month", "stipend"];
    const text = `﻿${columns.join(",")}\n19800,200,0,20000,intern,Dechen Lhamo,dechen@xceed.studio,2026-10,20000\n`;
    const result = check(text);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.figures.stipend).toBe(nu(20_000));
  });

  it("matches people by email, whatever the case", () => {
    expect(check(file(KARMA_OCTOBER.replace("karma@xceed.studio", "KARMA@Xceed.Studio"))).rows).toHaveLength(1);
  });
});

describe("errors: nothing comes in until every one is fixed", () => {
  const errorsOf = (...rows: string[]) => messages(check(file(...rows)).errors);

  it("lists them all with their rows, and returns no rows", () => {
    const result = check(file(KARMA_OCTOBER, "2026-13,karma@xceed.studio,Karma Wangchuk,full_time,50000,10000,,,,60000,,,0,600,,59400"));
    expect(result.rows).toEqual([]);
    expect(result.months).toEqual([]);
    expect(messages(result.errors)).toEqual(["3: The month “2026-13” should look like 2026-03."]);
  });

  it("an empty file, or one with headings only", () => {
    expect(messages(check("").errors)).toEqual(["-: This file is empty. Start from the template."]);
    expect(messages(check(`${HEADER}\r\n`).errors)).toEqual(["-: This file has headings but no rows yet."]);
  });

  it("a required column missing, an unknown or repeated column", () => {
    expect(messages(check("month,email,name,employment_type,gross,tds,take_home\n2026-10,a,b,full_time,1,0,1").errors)).toEqual([
      "1: The file needs a column called hc. Start from the template.",
    ]);
    expect(messages(check(`${HEADER},allowence\n${KARMA_OCTOBER},1`).errors)).toEqual(["1: DashTeam doesn’t know the column allowence. Check the spelling against the template."]);
    expect(messages(check(`${HEADER},tds\n${KARMA_OCTOBER},1`).errors)).toEqual(["1: The column tds appears twice."]);
  });

  it("no first payroll month yet", () => {
    expect(messages(check(file(KARMA_OCTOBER), { firstMonth: null }).errors)).toEqual([
      "-: Choose DashTeam’s first payroll month on Payroll first. Only months before it can be brought in.",
    ]);
  });

  it("a month on or after the first payroll month, or already in DashTeam", () => {
    expect(messages(check(file(KARMA_OCTOBER), { firstMonth: { year: 2026, month: 10 } }).errors)).toEqual([
      "2: October 2026 is on or after DashTeam’s first payroll month, so it’s paid in DashTeam, not brought in.",
    ]);
    expect(messages(check(file(KARMA_OCTOBER), { takenMonths: ["2026-10"] }).errors)).toEqual(["2: October 2026 is already in DashTeam."]);
  });

  it("an unknown email", () => {
    expect(errorsOf(KARMA_OCTOBER.replace("karma@", "karma.w@"))).toEqual([
      "2: Nobody in DashTeam has the email karma.w@xceed.studio. Add them on People first, including people who have left.",
    ]);
  });

  it("someone not employed that month, by their start and end dates", () => {
    expect(errorsOf(DECHEN_OCTOBER.replace("2026-10", "2026-05"))).toEqual([
      "2: Dechen Lhamo started on 1 Jun 2026, so can’t be paid in May 2026. Fix their dates on People, or the row.",
    ]);
    const left = check(file("2026-10,tshering@xceed.studio,Tshering Dorji,full_time,60000,10000,,,,70000,,,0,700,,69300"), { people: [TSHERING] });
    expect(messages(left.errors)).toEqual(["2: Tshering Dorji left on 20 Sep 2026, so can’t be paid in October 2026. Fix their dates on People, or the row."]);
  });

  it("an unknown employment type, or pay in the wrong place for it", () => {
    expect(errorsOf(KARMA_OCTOBER.replace("full_time", "contract"))).toEqual(["2: The employment type “contract” should be full_time or intern."]);
    expect(errorsOf(DECHEN_OCTOBER.replace("intern,,,20000", "intern,20000,,"))).toEqual([
      "2: stipend is blank.",
      "2: An intern row is paid as a stipend. Put the pay in stipend, not basic or allowance.",
    ]);
    expect(errorsOf(KARMA_OCTOBER.replace("full_time,50000,10000,", "full_time,50000,10000,100"))).toEqual([
      "2: A full-time row has no stipend. Put the pay in basic and allowance.",
    ]);
  });

  it("an amount that isn't one: words, negatives, three decimals", () => {
    expect(errorsOf(KARMA_OCTOBER.replace(",6125,", ",six,"))).toEqual(["2: tds “six” isn’t an amount. Use numbers like 45000 or 45,000.50."]);
    expect(errorsOf(KARMA_OCTOBER.replace(",650,", ",-650,"))).toEqual(["2: hc “-650” isn’t an amount. Use numbers like 45000 or 45,000.50."]);
    expect(errorsOf(KARMA_OCTOBER.replace(",650,", ",650.125,"))).toEqual(["2: hc “650.125” isn’t an amount. Use numbers like 45000 or 45,000.50."]);
  });

  it("a required amount left blank", () => {
    expect(errorsOf(KARMA_OCTOBER.replace(",6125,", ",,"))).toEqual(["2: tds is blank."]);
    expect(errorsOf(KARMA_OCTOBER.replace("full_time,50000", "full_time,"))).toContain("2: basic is blank.");
  });

  it("gross that isn't its parts, and take-home that isn't gross minus deductions", () => {
    expect(errorsOf(KARMA_OCTOBER.replace(",65000,", ",64500,").replace(",55225", ",54725"))).toEqual(["2: Gross is Nu. 64,500, but its parts add up to Nu. 65,000."]);
    expect(errorsOf(KARMA_OCTOBER.replace(",55225", ",55000"))).toEqual(["2: Take-home is Nu. 55,000, but gross minus deductions is Nu. 55,225."]);
  });

  it("the same person twice in a month", () => {
    expect(errorsOf(KARMA_OCTOBER, KARMA_OCTOBER)).toEqual(["3: Karma Wangchuk already has a row for October 2026 (row 2)."]);
  });

  it("a quote that never closes", () => {
    expect(messages(check(file('2026-10,"karma@xceed.studio')).errors)).toEqual(["-: A quote opened on line 2 is never closed."]);
  });
});

describe("warnings: shown, and the figures still come in as given", () => {
  it("a difference from DashTeam's own calculation", () => {
    const result = check(file(KARMA_OCTOBER.replace(",6125,", ",6130,").replace(",55225", ",55220")), { people: [KARMA] });
    expect(result.errors).toEqual([]);
    expect(messages(result.warnings)).toEqual([
      "2: Karma Wangchuk, October 2026: DashTeam works out TDS Nu. 6,125 (the file has Nu. 6,130) and take-home Nu. 55,225 (the file has Nu. 55,220). It’s brought in as given.",
    ]);
    expect(result.rows[0]?.figures.tds).toBe(nu(6_130));
  });

  it("months with no rules on file aren't compared", () => {
    const december = "2025-12,karma@xceed.studio,Karma Wangchuk,full_time,50000,10000,,,,60000,,,9999,1,,50000";
    const result = check(file(december, december.replace("2025-12", "2025-11")));
    expect(result.errors).toEqual([]);
    expect(messages(result.warnings)).toEqual(["-: DashTeam has no rules on file for November 2025 and December 2025, so they aren’t compared with its own calculation."]);
  });

  it("a name that isn't the one in DashTeam", () => {
    expect(messages(check(file(KARMA_OCTOBER.replace("Karma Wangchuk", "Karma W.")), { people: [KARMA] }).warnings)).toEqual([
      "2: The name “Karma W.” is Karma Wangchuk in DashTeam. The row is matched by email.",
    ]);
  });

  it("someone employed that month with no row", () => {
    expect(messages(check(file(KARMA_OCTOBER)).warnings)).toEqual(["-: Dechen Lhamo was employed in October 2026 but has no row for it."]);
  });
});

describe("comparing with DashTeam's own calculation", () => {
  it("treats the row's pay as a full month, so a part month compares on its own gross", () => {
    // Pema, 17 of 31 days in October: 24,677 due. No TDS below the first band; HC 1%.
    const comparison = compareWithEngine(
      {
        month: { year: 2026, month: 10 },
        employmentType: "full_time",
        figures: { basic: nu(21_935), allowance: nu(2_742), stipend: 0, arrear: 0, otherEarnings: 0, hc: nu(247), pf: 0, gis: 0, tds: 0, otherDeductions: 0, takeHome: nu(24_430) },
      },
      RULES,
    );
    expect(comparison).toEqual({ status: "compared", differences: [] });
  });
});

describe("the template", () => {
  it("has every column, and its examples pass", () => {
    const template = payrollImportTemplate();
    expect(parseCsv(template)[0]?.cells).toEqual([...PAYROLL_IMPORT_COLUMNS]);
    const people: ImportPerson[] = [
      { id: "s", email: "sonam@example.bt", fullName: "Sonam Wangmo", startDate: "2025-03-03", endDate: null },
      { id: "d", email: "dechen@example.bt", fullName: "Dechen Lhamo", startDate: "2026-01-01", endDate: null },
    ];
    const result = check(template, { people });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
