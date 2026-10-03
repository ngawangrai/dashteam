import { describe, expect, it } from "vitest";
import type { LeaveRequestFacts } from "@/modules/leave/balance";
import type { Holiday } from "@/modules/leave/holidays";
import { V1_HOLIDAYS } from "@/modules/leave/holidays-v1";
import type { PayTerms } from "@/modules/people/pay";
import type { PayrollMonth, RuleRow } from "@/modules/rules/types";
import { V1_LEAVE_RULE_ROWS, V1_RULE_ROWS, V1_SETTINGS_RULE_ROWS } from "@/modules/rules/v1";
import { type RunInput, type RunPerson, buildRun, tryLine } from "./build";
import type { RunLine } from "./lines";

// The monthly payroll run: who is paid, from which inputs, and what the review screen flags.
// Every figure in the mixed-team test is worked out by hand in the comments, to the ngultrum.

const nu = (amount: number) => Math.round(amount * 100);
const OCTOBER: PayrollMonth = { year: 2026, month: 10 };
const SEPTEMBER: PayrollMonth = { year: 2026, month: 9 };
const RULES: RuleRow[] = [...V1_RULE_ROWS, ...V1_LEAVE_RULE_ROWS, ...V1_SETTINGS_RULE_ROWS];
const HOLIDAYS: Holiday[] = V1_HOLIDAYS.map((h) => ({ ...h }));

const salary = (basic: number, allowances: number, effectiveFrom = "2025-01-01"): PayTerms =>
  ({ effectiveFrom, employmentType: "full_time", basic: nu(basic), allowances: nu(allowances) }) as PayTerms;
const stipend = (amount: number, effectiveFrom = "2025-01-01"): PayTerms =>
  ({ effectiveFrom, employmentType: "intern", stipend: nu(amount) }) as PayTerms;

function person(id: string, fields: Partial<RunPerson> = {}): RunPerson {
  return {
    id,
    fullName: `${id[0]?.toUpperCase()}${id.slice(1)} Test`,
    startDate: "2025-01-06",
    endDate: null,
    pay: [salary(40_000, 5_000)],
    hasTpn: true,
    hasBankAccount: true,
    leave: [],
    pendingChange: null,
    ...fields,
  };
}

let lineCount = 0;
function line(personId: string, kind: RunLine["kind"], amount: number, note = ""): RunLine {
  lineCount += 1;
  return { id: `line-${lineCount}`, personId, kind, amount: nu(amount), note, source: "manual" };
}

const unpaid = (id: string, startDate: string, endDate: string, status: LeaveRequestFacts["status"] = "approved"): LeaveRequestFacts => ({
  id,
  leaveType: "unpaid",
  status,
  startDate,
  endDate,
  startHalf: false,
  endHalf: false,
  childOrder: null,
});

function input(fields: Partial<RunInput> = {}): RunInput {
  return {
    month: OCTOBER,
    people: [],
    lines: [],
    ruleRows: RULES,
    holidays: HOLIDAYS,
    firstMonth: OCTOBER,
    lockedMonths: [],
    previousTakeHome: {},
    acknowledged: [],
    ...fields,
  };
}

// ── The mixed team ──────────────────────────────────────────────────────────────

const MIXED_TEAM: RunPerson[] = [
  person("karma", { pay: [salary(50_000, 10_000)] }),
  person("dechen", { pay: [stipend(20_000)] }),
  person("pema", { startDate: "2026-10-15", pay: [salary(40_000, 5_000, "2026-10-01")] }),
  person("tshering", { endDate: "2026-10-20", pay: [salary(60_000, 10_000)] }),
  // Wed 7 and Thu 8 October are working days (Dashain is the 21st).
  person("sonam", { leave: [unpaid("sonam-unpaid", "2026-10-07", "2026-10-08")] }),
  // Not employed in October: left in September, and starts in November.
  person("left", { endDate: "2026-09-30" }),
  person("later", { startDate: "2026-11-02", pay: [salary(40_000, 0, "2026-11-01")] }),
];

const MIXED_LINES = [line("karma", "arrear", 5_000, "September increment"), line("karma", "advance_recovery", 3_000, "Advance, 1 of 3")];

describe("a mixed team in October 2026, by hand", () => {
  const run = buildRun(input({ people: MIXED_TEAM, lines: MIXED_LINES }));
  const figures = (id: string) => {
    const result = run.people.find((p) => p.personId === id)?.result;
    if (!result) throw new Error(`${id} has no result`);
    return result;
  };

  it("includes everyone employed for any part of the month, and nobody else", () => {
    expect(run.people.map((p) => p.personId)).toEqual(["dechen", "karma", "pema", "sonam", "tshering"]);
  });

  it("pays a full-timer with an arrear and an advance recovery", () => {
    // Gross 60,000 + 5,000 arrear = 65,000. HC 1% = 650.
    // Taxable 65,000 → ×12 = 7,80,000: 10,000 + 37,500 + 26,000 = 73,500 a year ÷ 12 = 6,125.
    // Take-home 65,000 − 650 − 6,125 − 3,000 = 55,225.
    expect(figures("karma")).toMatchObject({ gross: nu(65_000), healthContribution: nu(650), tds: nu(6_125), recoveries: nu(3_000), takeHome: nu(55_225) });
  });

  it("pays an intern their stipend", () => {
    // 20,000 × 12 = 2,40,000, under the first band: no TDS. HC 200. Take-home 19,800.
    expect(figures("dechen")).toMatchObject({ gross: nu(20_000), healthContribution: nu(200), tds: 0, takeHome: nu(19_800) });
  });

  it("pro-rates a joiner from their first day", () => {
    // 15 to 31 October is 17 days. 45,000 × 17 ÷ 31 = 24,677.42 → 24,677. HC 246.77 → 247.
    // Taxable 24,677 → up to 24,700 → ×12 = 2,96,400, under 3,00,000: no TDS. Take-home 24,430.
    expect(figures("pema")).toMatchObject({ daysPaid: 17, gross: nu(24_677), healthContribution: nu(247), tds: 0, takeHome: nu(24_430) });
  });

  it("pro-rates a leaver to their last working day", () => {
    // 1 to 20 October is 20 days. 70,000 × 20 ÷ 31 = 45,161.29 → 45,161. HC 451.61 → 452.
    // Taxable → 45,200 → ×12 = 5,42,400: 10,000 + 21,360 = 31,360 ÷ 12 = 2,613.33 → 2,613.
    // Take-home 45,161 − 452 − 2,613 = 42,096.
    expect(figures("tshering")).toMatchObject({ daysPaid: 20, gross: nu(45_161), healthContribution: nu(452), tds: nu(2_613), takeHome: nu(42_096) });
  });

  it("takes 2 unpaid days off a full month", () => {
    // 29 of 31 days paid. 45,000 × 29 ÷ 31 = 42,096.77 → 42,097. HC 420.97 → 421.
    // Taxable → 42,100 → ×12 = 5,05,200: 10,000 + 15,780 = 25,780 ÷ 12 = 2,148.33 → 2,148.
    // Take-home 42,097 − 421 − 2,148 = 39,528.
    expect(run.people.find((p) => p.personId === "sonam")?.unpaidLeaveDays).toBe(2);
    expect(figures("sonam")).toMatchObject({ daysPaid: 29, gross: nu(42_097), healthContribution: nu(421), tds: nu(2_148), takeHome: nu(39_528) });
  });

  it("adds up the totals and what to remit", () => {
    // Gross 65,000 + 20,000 + 24,677 + 45,161 + 42,097 = 1,96,935.
    // HC 650 + 200 + 247 + 452 + 421 = 1,970. TDS 6,125 + 2,613 + 2,148 = 10,886.
    // Take-home 55,225 + 19,800 + 24,430 + 42,096 + 39,528 = 1,81,079. Remit TDS + HC = 12,856.
    expect(run.totals).toEqual({
      people: 5,
      gross: nu(196_935),
      healthContribution: nu(1_970),
      providentFund: 0,
      gis: 0,
      tds: nu(10_886),
      recoveries: nu(3_000),
      takeHome: nu(181_079),
      remit: nu(12_856),
    });
  });

  it("is due on 10 November", () => {
    expect(run.dueDate).toBe("2026-11-10");
  });

  it("shows deductions as everything between gross and take-home", () => {
    const karma = run.people.find((p) => p.personId === "karma");
    expect(karma?.deductions).toBe(nu(650 + 6_125 + 3_000));
  });

  it("records the rules version for every person", () => {
    expect(run.people.every((p) => p.result?.ruleIds.includes(`v1:tds:${p.employmentType}`))).toBe(true);
    expect(run.ruleIds).toEqual(expect.arrayContaining(["v1:tds:full_time", "v1:tds:intern", "v1:payroll_settings:full_time"]));
  });
});

// ── One-off lines ─────────────────────────────────────────────────────────────

describe("one-off lines", () => {
  const karma = person("karma", { pay: [salary(50_000, 10_000)] });
  const resultWith = (lines: RunLine[]) => buildRun(input({ people: [karma], lines })).people[0]?.result;
  const base = resultWith([]);

  it("never change TDS or HC for an advance recovery or another deduction", () => {
    const after = resultWith([line("karma", "advance_recovery", 3_000), line("karma", "other_deduction", 500)]);
    expect(after).toMatchObject({ gross: base?.gross, tds: base?.tds, healthContribution: base?.healthContribution });
    expect(after?.takeHome).toBe((base?.takeHome ?? 0) - nu(3_500));
  });

  it("take a leave recovery off gross, so HC and TDS fall too", () => {
    // 60,000 − 2,000 = 58,000. HC 580. ×12 = 6,96,000: 10,000 + 37,500 + 9,200 = 56,700 ÷ 12 = 4,725.
    const after = resultWith([line("karma", "leave_recovery", 2_000, "Leave taken beyond entitlement")]);
    expect(after).toMatchObject({ gross: nu(58_000), healthContribution: nu(580), tds: nu(4_725) });
    expect(after?.healthContribution).toBeLessThan(base?.healthContribution ?? 0);
  });

  it("add arrears, bonuses and other earnings to gross", () => {
    const after = resultWith([line("karma", "arrear", 1_000), line("karma", "bonus", 2_000), line("karma", "other_earning", 300)]);
    expect(after?.gross).toBe(nu(63_300));
  });

  it("map onto the payroll input as lines and recoveries", () => {
    const run = buildRun(
      input({
        people: [karma],
        lines: [
          line("karma", "arrear", 1, "a"),
          line("karma", "bonus", 2, "b"),
          line("karma", "other_earning", 3, "c"),
          line("karma", "leave_recovery", 4, "d"),
          line("karma", "advance_recovery", 5, "e"),
          line("karma", "other_deduction", 6, "f"),
        ],
      }),
    );
    expect(run.people[0]?.input).toMatchObject({
      lines: [
        { kind: "arrear", amount: 100, note: "a" },
        { kind: "bonus", amount: 200, note: "b" },
        { kind: "adjustment", amount: 300, note: "c" },
        { kind: "adjustment", amount: -400, note: "d" },
      ],
      recoveries: [
        { kind: "advance_recovery", amount: 500, note: "e" },
        { kind: "other_deduction", amount: 600, note: "f" },
      ],
    });
  });

  it("refuse a recovery that would take take-home below zero", () => {
    const run = input({ people: [karma] });
    // Take-home is 54,275; 54,276 is a ngultrum too much.
    expect(tryLine(run, line("karma", "advance_recovery", 54_276))).toEqual({
      ok: false,
      reason: "That’s more than Karma’s take-home this month. Recover the rest next month.",
    });
    expect(tryLine(run, line("karma", "advance_recovery", 54_275))).toEqual({ ok: true, takeHome: 0 });
  });

  it("refuse a leave recovery larger than gross", () => {
    expect(tryLine(input({ people: [karma] }), line("karma", "leave_recovery", 60_001)).ok).toBe(false);
  });

  it("refuse a line for someone who isn't paid this month", () => {
    expect(tryLine(input({ people: [karma] }), line("nobody", "bonus", 1))).toEqual({ ok: false, reason: "This person isn’t paid in October." });
  });
});

// ── Exceptions ──────────────────────────────────────────────────────────────────

describe("exceptions on the review screen", () => {
  const kinds = (fields: Partial<RunInput>, id: string) =>
    buildRun(input(fields))
      .people.find((p) => p.personId === id)
      ?.exceptions.map((e) => `${e.kind}: ${e.label}`);

  it("flag a new joiner, a leaver, unpaid leave and one-offs", () => {
    const fields = { people: MIXED_TEAM, lines: MIXED_LINES };
    expect(kinds(fields, "pema")).toEqual(["new_joiner: Joined 15 Oct"]);
    expect(kinds(fields, "tshering")).toEqual(["leaver: Last day 20 Oct"]);
    expect(kinds(fields, "sonam")).toEqual(["unpaid_leave: 2 days unpaid"]);
    expect(kinds(fields, "karma")).toEqual(["one_offs: 2 one-offs"]);
    expect(kinds(fields, "dechen")).toEqual([]);
  });

  it("flag a pay change starting this month, but not a joiner's first pay", () => {
    const raised = person("raised", { pay: [salary(40_000, 0), salary(45_000, 0, "2026-10-01")] });
    expect(kinds({ people: [raised] }, "raised")).toEqual(["pay_change: New pay"]);
  });

  it("flag take-home 10% or more up or down from last month", () => {
    // Sonam's full month: 45,000 − 450 HC − 2,583 TDS = 41,967.
    const sonam = person("sonam");
    const at = (previous: number) => kinds({ people: [sonam], previousTakeHome: { sonam: nu(previous) } }, "sonam");
    expect(at(41_967)).toEqual([]);
    // 41,967 is 10% above 38,151.82: from 38,152 the rise is 3,815, under 10%; from 38,151 it's 3,816, over it.
    expect(at(38_152)).toEqual([]);
    expect(at(38_151)).toEqual(["large_change: Take-home up 10%"]);
    // From 50,000 it falls 8,033, or 16%.
    expect(at(50_000)).toEqual(["large_change: Take-home down 16%"]);
  });

  it("compare nothing when there is no earlier month", () => {
    expect(kinds({ people: [person("sonam")] }, "sonam")).toEqual([]);
  });
});

// ── Checks before locking ─────────────────────────────────────────────────────

describe("checks before locking", () => {
  const checks = (fields: Partial<RunInput>) => buildRun(input(fields)).checks.map((c) => ({ key: c.key, kind: c.kind, title: c.title }));

  it("must clear an earlier month that isn't locked", () => {
    const run = buildRun(input({ people: [person("sonam")], firstMonth: { year: 2026, month: 8 }, lockedMonths: [{ year: 2026, month: 8 }] }));
    expect(run.checks).toContainEqual(expect.objectContaining({ key: "earlier_month:2026-09", kind: "must_clear", title: "September payroll isn’t locked yet" }));
    expect(run.ready).toBe(false);
  });

  it("must clear anyone with no pay", () => {
    expect(checks({ people: [person("pema", { pay: [] })] })).toContainEqual({ key: "no_pay:pema", kind: "must_clear", title: "Pema has no pay for October" });
  });

  it("must clear a month before the first month, or with no first month set", () => {
    expect(checks({ people: [person("sonam")], month: SEPTEMBER })[0]).toMatchObject({ key: "before_first_month", kind: "must_clear" });
    expect(checks({ people: [person("sonam")], firstMonth: null })[0]).toMatchObject({ key: "no_first_month", kind: "must_clear" });
  });

  it("can acknowledge pending leave, pending profile changes, missing TPN or bank, and tentative holidays", () => {
    const pending = { ...unpaid("pending-leave", "2026-10-28", "2026-10-30", "pending"), leaveType: "annual" as const };
    const tentative: Holiday = { name: "Test Tshechu", startDate: "2026-10-26", endDate: "2026-10-26", year: 2026, kind: "lunar", scope: "thimphu", status: "tentative", source: "test", note: "" };
    const result = checks({
      people: [
        person("sonam", { leave: [pending], pendingChange: { id: "change-1", fields: ["bank"] } }),
        person("pema", { hasTpn: false, hasBankAccount: false }),
      ],
      holidays: [...HOLIDAYS, tentative],
    });
    expect(result).toEqual([
      { key: "pending_leave:pending-leave", kind: "acknowledge", title: "Sonam’s annual leave on Wed 28 – Fri 30 Oct is waiting for a decision" },
      { key: "pending_change:change-1", kind: "acknowledge", title: "Sonam asked to change their bank details" },
      { key: "missing_tpn:pema", kind: "acknowledge", title: "Pema has no TPN on file" },
      { key: "missing_bank:pema", kind: "acknowledge", title: "Pema has no bank account on file" },
      { key: "tentative_holiday:2026-10-26:Test Tshechu", kind: "acknowledge", title: "Test Tshechu on Mon 26 Oct is tentative" },
    ]);
  });

  it("is ready once every check is cleared or acknowledged", () => {
    const fields = { people: [person("pema", { hasTpn: false })] };
    expect(buildRun(input(fields)).ready).toBe(false);
    const acknowledged = buildRun(input({ ...fields, acknowledged: ["missing_tpn:pema"] }));
    expect(acknowledged.ready).toBe(true);
    expect(acknowledged.checks[0]?.acknowledged).toBe(true);
  });

  it("ignores leave and holidays outside the month", () => {
    const septemberLeave = { ...unpaid("old", "2026-09-07", "2026-09-08", "pending"), leaveType: "annual" as const };
    expect(checks({ people: [person("sonam", { leave: [septemberLeave] })] })).toEqual([]);
  });

  it("must clear a take-home below zero, for example after unpaid leave", () => {
    // A recovery added when the month was full, then most of the month became unpaid.
    const sonam = person("sonam", { leave: [unpaid("long", "2026-10-01", "2026-10-30")] });
    expect(checks({ people: [sonam], lines: [line("sonam", "advance_recovery", 20_000)] })).toContainEqual({
      key: "negative:sonam",
      kind: "must_clear",
      title: "Sonam’s take-home is below zero",
    });
  });

  it("must clear a month that hasn't started yet", () => {
    expect(checks({ people: [person("sonam")], today: "2026-09-30" })[0]).toEqual({
      key: "not_started",
      kind: "must_clear",
      title: "October hasn’t started yet",
    });
    expect(checks({ people: [person("sonam")], today: "2026-10-01" })).toEqual([]);
  });

  it("is ready with nobody to pay, so an empty month can still be locked", () => {
    expect(buildRun(input()).ready).toBe(true);
  });
});
