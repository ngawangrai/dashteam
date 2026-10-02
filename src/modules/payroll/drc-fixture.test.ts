import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRules } from "@/modules/rules/resolve";
import type { TdsRule } from "@/modules/rules/types";
import { V1_RULE_ROWS } from "@/modules/rules/v1";
import { calculateTds } from "./calculate";

// The acceptance test for TDS. docs/fixtures/drc_tds_table.csv is DRC's own table and is never edited.
// Rows are monthly taxable salary (after PF and GIS) in whole ngultrum; we work in chhertum.

const CH = 100;
const rules = resolveRules(V1_RULE_ROWS, "full_time", { year: 2026, month: 10 });

type FixtureRow = { from: number; to: number; tds: number };

const rows: FixtureRow[] = readFileSync(join(process.cwd(), "docs/fixtures/drc_tds_table.csv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => {
    const [from, to, tds] = line.split(",").map(Number);
    return { from: from ?? NaN, to: to ?? NaN, tds: tds ?? NaN };
  });

function tdsInNu(taxableNu: number, rule: TdsRule = rules.tds): number {
  return calculateTds(Math.round(taxableNu * CH), rule).tds / CH;
}

describe("DRC TDS table (Annexure III)", () => {
  it("has all 1,319 rows", () => {
    expect(rows).toHaveLength(1319);
  });

  it.each(rows)("Nu. $from to $to gives TDS Nu. $tds", ({ from, to, tds }) => {
    expect(tdsInNu(from)).toBe(tds);
    expect(tdsInNu(to)).toBe(tds);
  });
});

describe("DRC worked examples above the table", () => {
  it("Nu. 1,25,000 gives Nu. 20,208", () => {
    expect(tdsInNu(125_000)).toBe(20_208);
  });

  it("Nu. 3,22,500 gives Nu. 79,458", () => {
    expect(tdsInNu(322_500)).toBe(79_458);
  });
});

// The DRC PDF skips these two ranges. The band method covers them; values to be confirmed by the accountant before go-live.
describe("gaps in the DRC table (PENDING ACCOUNTANT CONFIRMATION)", () => {
  it("Nu. 32,000 (gap 30,201 to 35,500) gives Nu. 700, pending accountant confirmation", () => {
    expect(tdsInNu(32_000)).toBe(700);
  });

  it("Nu. 80,000 (gap 77,901 to 83,200) gives Nu. 9,125, pending accountant confirmation", () => {
    expect(tdsInNu(80_000)).toBe(9_125);
  });
});

describe("taxable rounding", () => {
  it("leaves exactly Nu. 25,000 untaxed", () => {
    expect(calculateTds(25_000 * CH, rules.tds)).toEqual({ taxableForTds: 25_000 * CH, tds: 0 });
  });

  it("rounds a single chhertum over Nu. 25,000 up to the next Nu. 100", () => {
    expect(calculateTds(25_000 * CH + 1, rules.tds)).toEqual({ taxableForTds: 25_100 * CH, tds: 10 * CH });
  });

  it("taxes nothing when taxable is zero", () => {
    expect(calculateTds(0, rules.tds)).toEqual({ taxableForTds: 0, tds: 0 });
  });

  it("rounds an exact half ngultrum up under 'nearest'", () => {
    // Synthetic rule: 50% on everything, so Nu. 1 taxable gives exactly Nu. 0.50.
    const halves: TdsRule = {
      bands: [{ fromAnnual: 0, rate: 5_000 }],
      monthsPerYear: 1,
      taxableRoundUpTo: CH,
      resultRoundTo: CH,
      resultRounding: "nearest",
    };
    expect(tdsInNu(1, halves)).toBe(1);
    expect(tdsInNu(1, { ...halves, resultRounding: "down" })).toBe(0);
  });
});
