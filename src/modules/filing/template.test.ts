import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mixedTeam, snapshotOf, OCTOBER, RULES } from "../../../tests/support/mixed-team";
import { resolveRules } from "@/modules/rules/resolve";
import { scheduleRows } from "./schedule";
import { fillIt1aTemplate } from "./template";

// The upload file is the official DRC template with people filled in from row 4, nothing else changed.

const OFFICIAL = readFileSync(join(process.cwd(), "docs/fixtures/FORM IT-1(a) MONTHLY SALARY SCHEDULE.XLS"));
const BUNDLED = readFileSync(join(process.cwd(), "src/modules/filing/template/it1a.xls"));

const rows = scheduleRows(
  mixedTeam().people.map((p) => ({ ...snapshotOf(p), personId: p.personId, tpn: p.personId === "pema" ? "000123" : "1234567" })),
  { proration: (type) => resolveRules(RULES, type, OCTOBER).proration, included: (type) => resolveRules(RULES, type, OCTOBER).it1aInclusion.include },
);
const filled = XLSX.read(fillIt1aTemplate(rows), { type: "buffer" });
const template = XLSX.read(OFFICIAL, { type: "buffer" });
const sheet = filled.Sheets.Sheet1 ?? {};
const cell = (ref: string) => sheet[ref] as XLSX.CellObject | undefined;

describe("the IT-1(a) upload file", () => {
  it("fills the official template, which is bundled exactly as DRC published it", () => {
    expect(BUNDLED.equals(OFFICIAL)).toBe(true);
  });

  it("keeps the template's sheets, title, headers, column numbers and merges", () => {
    expect(filled.SheetNames).toEqual(template.SheetNames);
    const header = (ws: XLSX.WorkSheet) =>
      ["A1", "A2", "B2", "B3", "C2", "C3", "D3", "E3", "F3", "G3", "H3", "I3", "J3", "K3", "L2", "L3"].map((ref) => ws[ref]?.v);
    expect(header(sheet)).toEqual(header(template.Sheets.Sheet1 ?? {}));
    expect(header(sheet).slice(0, 2)).toEqual(["FORM IT-1(a) MONTHLY SALARY SCHEDULE", "TName of Employee"]);
    expect(sheet["!merges"]).toEqual(template.Sheets.Sheet1?.["!merges"]);
  });

  it("has one row per person from row 4, in name order, and no totals row", () => {
    const names = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 3 }).map((row) => row[0]);
    expect(names).toEqual(["Dechen Lhamo", "Karma Wangchuk", "Pema Choden", "Sonam Wangmo", "Tshering Dorji"]);
    expect(XLSX.utils.decode_range(sheet["!ref"] ?? "A1").e.r).toBe(3 + rows.length - 1);
  });

  it("writes TPN as text, so leading zeros stay, and every amount as a number in ngultrum", () => {
    expect(cell("B6")).toMatchObject({ t: "s", v: "000123" });
    // Karma, row 5: 50,000 · 10,000 · 5,000 · 65,000 · 0 · 0 · 65,000 · 6,125 · 650 · 6,775
    expect(["C5", "D5", "E5", "F5", "G5", "H5", "I5", "J5", "K5", "L5"].map((ref) => [cell(ref)?.t, cell(ref)?.v])).toEqual(
      [50_000, 10_000, 5_000, 65_000, 0, 0, 65_000, 6_125, 650, 6_775].map((value) => ["n", value]),
    );
  });

  it("keeps chhertum only where an amount has them", () => {
    const withChhertum = [{ ...rows[0]!, basic: 1_234_550, gross: 1_234_550 }];
    const sheetWith = XLSX.read(fillIt1aTemplate(withChhertum), { type: "buffer" }).Sheets.Sheet1 ?? {};
    expect(sheetWith.C4?.v).toBe(12_345.5);
  });

  it("is an Excel 97–2003 file, like the template", () => {
    expect(fillIt1aTemplate(rows).subarray(0, 8).toString("hex")).toBe(OFFICIAL.subarray(0, 8).toString("hex"));
  });
});
