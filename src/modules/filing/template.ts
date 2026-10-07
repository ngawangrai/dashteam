import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import type { Chhertum } from "@/modules/rules/types";
import type { ScheduleRow } from "./schedule";

// The upload file is DRC's own IT-1(a) template (docs/fixtures, bundled byte for byte in ./template)
// with people written in from row 4. Rows 1 to 3, the merges and the sheets are left exactly as DRC
// made them. No totals row: RAMIS reads every row under the headers as a person.
// SheetJS is the one maintained library that reads and writes Excel 97–2003 (.xls), which the template is.

const TEMPLATE = join(process.cwd(), "src/modules/filing/template/it1a.xls");
const FIRST_ROW = "A4";
const CH_PER_NU = 100;

const nu = (chhertum: Chhertum) => chhertum / CH_PER_NU;

export function fillIt1aTemplate(rows: readonly ScheduleRow[]): Buffer {
  const workbook = XLSX.read(readFileSync(TEMPLATE), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet) throw new Error("The IT-1(a) template has no first sheet");

  XLSX.utils.sheet_add_aoa(
    sheet,
    rows.map((row) => [row.name, row.tpn, nu(row.basic), nu(row.allowance), nu(row.arrear), nu(row.gross), nu(row.pf), nu(row.gis), nu(row.net), nu(row.tds), nu(row.hc), nu(row.total)]),
    { origin: FIRST_ROW },
  );
  // A TPN is an identifier, not a number: keep it as text so a leading zero survives.
  rows.forEach((_row, i) => {
    const tpn = sheet[`B${4 + i}`] as XLSX.CellObject | undefined;
    if (tpn) tpn.t = "s";
  });
  return XLSX.write(workbook, { bookType: "biff8", type: "buffer" }) as Buffer;
}
