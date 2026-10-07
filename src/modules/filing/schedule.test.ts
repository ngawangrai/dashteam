import { describe, expect, it } from "vitest";
import { resolveRules } from "@/modules/rules/resolve";
import type { EmploymentType, RuleRow } from "@/modules/rules/types";
import { MIXED_LINES, OCTOBER, RULES, line, mixedTeam, nu, personIn, snapshotOf } from "../../../tests/support/mixed-team";
import { ReconciliationError, type ScheduleSource, scheduleRows, scheduleTotals } from "./schedule";

// The IT-1(a) monthly salary schedule, worked out from the locked snapshot. Every figure here is the
// hand-worked example from the milestone 6 plan, and every row must reconcile to the snapshot.

const rulesFor = (rows: RuleRow[] = RULES) => ({
  proration: (type: EmploymentType) => resolveRules(rows, type, OCTOBER).proration,
  included: (type: EmploymentType) => resolveRules(rows, type, OCTOBER).it1aInclusion.include,
});

function sourcesFrom(run: ReturnType<typeof mixedTeam>): ScheduleSource[] {
  return run.people.map((p) => ({ ...snapshotOf(p), personId: p.personId, tpn: `1000${p.personId.length}` }));
}

const scheduleOf = (lines = MIXED_LINES, rows: RuleRow[] = RULES) => scheduleRows(sourcesFrom(mixedTeam(lines)), rulesFor(rows));
const row = (rows: ReturnType<typeof scheduleOf>, id: string) => {
  const found = rows.find((r) => r.personId === id);
  if (!found) throw new Error(`${id} isn't on the schedule`);
  return found;
};
const columns = (r: ReturnType<typeof row>) => [r.basic, r.allowance, r.arrear, r.gross, r.pf, r.gis, r.net, r.tds, r.hc, r.total].map((ch) => ch / 100);

describe("the mixed team for October 2026, by hand", () => {
  const schedule = scheduleOf();

  it.each([
    // C basic, D allowance, E arrear, F gross, G PF, H GIS, I net, J TDS, K HC, L total
    ["karma", [50_000, 10_000, 5_000, 65_000, 0, 0, 65_000, 6_125, 650, 6_775]],
    ["dechen", [20_000, 0, 0, 20_000, 0, 0, 20_000, 0, 200, 200]],
    ["pema", [21_935, 2_742, 0, 24_677, 0, 0, 24_677, 0, 247, 247]],
    ["tshering", [38_710, 6_451, 0, 45_161, 0, 0, 45_161, 2_613, 452, 3_065]],
    ["sonam", [37_419, 4_678, 0, 42_097, 0, 0, 42_097, 2_148, 421, 2_569]],
  ])("%s", (id, expected) => {
    expect(columns(row(schedule, id))).toEqual(expected);
  });

  it("lists people in name order, with their name and TPN", () => {
    expect(schedule.map((r) => r.name)).toEqual(["Dechen Lhamo", "Karma Wangchuk", "Pema Choden", "Sonam Wangmo", "Tshering Dorji"]);
    expect(row(schedule, "karma").tpn).toBe("10005");
  });

  it("reconciles every row: F = C + D + E, I = F − G − H, L = J + K, and each equals the snapshot", () => {
    const run = mixedTeam();
    for (const r of schedule) {
      const locked = personIn(run, r.personId).result;
      expect(r.gross).toBe(r.basic + r.allowance + r.arrear);
      expect(r.net).toBe(r.gross - r.pf - r.gis);
      expect(r.total).toBe(r.tds + r.hc);
      expect({ gross: r.gross, net: r.net, tds: r.tds, hc: r.hc }).toEqual({ gross: locked?.gross, net: locked?.taxable, tds: locked?.tds, hc: locked?.healthContribution });
    }
  });

  it("totals the snapshot's gross, TDS and HC exactly", () => {
    const totals = scheduleTotals(schedule);
    const run = mixedTeam();
    expect(totals).toMatchObject({ gross: run.totals.gross, tds: run.totals.tds, hc: run.totals.healthContribution, total: run.totals.remit });
    // 1,96,935 gross; TDS 10,886 + HC 1,970 = 12,856 (milestone 4's hand calculation).
    expect(totals).toMatchObject({ gross: nu(196_935), tds: nu(10_886), hc: nu(1_970), total: nu(12_856), people: 5 });
  });
});

describe("where each kind of line goes", () => {
  it("puts a bonus and other earnings in Benefit / Allowance", () => {
    const karma = row(scheduleOf([line("karma", "bonus", 2_000), line("karma", "other_earning", 500)]), "karma");
    expect(columns(karma).slice(0, 4)).toEqual([50_000, 12_500, 0, 62_500]);
  });

  it("puts an arrear in Salary Arrear", () => {
    expect(row(scheduleOf([line("karma", "arrear", 1_234)]), "karma").arrear).toBe(nu(1_234));
  });

  it("takes a leave recovery off Basic Salary, so gross, TDS and HC match the snapshot", () => {
    const karma = row(scheduleOf([line("karma", "leave_recovery", 2_000)]), "karma");
    expect(columns(karma)).toEqual([48_000, 10_000, 0, 58_000, 0, 0, 58_000, 4_725, 580, 5_305]);
  });

  it("leaves after-tax deductions off the form entirely", () => {
    const without = row(scheduleOf([]), "karma");
    const withThem = row(scheduleOf([line("karma", "advance_recovery", 3_000), line("karma", "other_deduction", 700)]), "karma");
    expect(withThem).toEqual(without);
  });

  it("always splits a part month so basic and allowance add up exactly", () => {
    for (const r of scheduleOf()) expect(r.basic + r.allowance + r.arrear).toBe(r.gross);
  });
});

describe("interns", () => {
  it("are on the schedule while the inclusion setting is on, with their stipend as basic salary", () => {
    expect(columns(row(scheduleOf(), "dechen")).slice(0, 4)).toEqual([20_000, 0, 0, 20_000]);
  });

  it("are left off when a later setting excludes them, and only from that month", () => {
    const off: RuleRow = { id: "test:it1a-off", key: "it1a_inclusion", employmentType: "intern", effectiveFrom: "2026-10-01", value: { include: false } };
    const schedule = scheduleOf(MIXED_LINES, [...RULES, off]);
    expect(schedule.map((r) => r.personId)).not.toContain("dechen");
    expect(scheduleTotals(schedule).people).toBe(4);
  });
});

describe("a schedule that doesn't reconcile", () => {
  it("is refused, never written", () => {
    const sources = sourcesFrom(mixedTeam());
    const broken = sources.map((s) => (s.personId === "karma" ? { ...s, result: { ...s.result, gross: s.result.gross + 1 } } : s));
    expect(() => scheduleRows(broken, rulesFor())).toThrow(ReconciliationError);
  });
});
