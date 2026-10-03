import { describe, expect, it } from "vitest";
import type { RuleRow } from "@/modules/rules/types";
import { V1_LEAVE_RULE_ROWS } from "@/modules/rules/v1";
import { type LeaveRequestFacts, balanceFor, entitlementFor, monthsEmployedInYear } from "./balance";

const calendar = { workingWeek: [1, 2, 3, 4, 5], holidays: ["2026-11-11"] };
const longServing = { startDate: "2025-03-03", endDate: null };

let next = 0;
function request(fields: Partial<LeaveRequestFacts> & Pick<LeaveRequestFacts, "startDate" | "endDate">): LeaveRequestFacts {
  next += 1;
  return { id: `r${next}`, leaveType: "annual", status: "approved", startHalf: false, endHalf: false, childOrder: null, ...fields };
}

const annual2026 = (person = longServing, requests: LeaveRequestFacts[] = [], rows: RuleRow[] = V1_LEAVE_RULE_ROWS, employmentType: "full_time" | "intern" = "full_time") =>
  balanceFor({ leaveType: "annual", year: 2026, employmentType, person, requests, ruleRows: rows, calendar });

describe("months employed in a leave year", () => {
  it.each([
    ["all year", "2025-03-03", null, 12],
    ["joining on the 15th counts that month", "2026-03-15", null, 10],
    ["joining on the 16th does not", "2026-03-16", null, 9],
    ["leaving on the 14th does not count that month", "2025-03-03", "2026-10-14", 9],
    ["leaving on the 15th counts it", "2025-03-03", "2026-10-15", 10],
    ["leaving on the last day counts it", "2025-03-03", "2026-10-31", 10],
    ["joining and leaving in the same year", "2026-03-10", "2026-08-20", 6],
    ["joining after the year", "2027-02-01", null, 0],
  ])("%s", (_label, startDate, endDate, months) => {
    expect(monthsEmployedInYear(2026, { startDate, endDate }, 15)).toBe(months);
  });
});

describe("entitlement", () => {
  it.each([
    [12, 25],
    [10, 21], // 25 × 10/12 = 20.83 → 21
    [9, 19], // 25 × 9/12 = 18.75 → 19 (half up)
    [6, 12.5],
  ])("%i months of 25 days a year is %f", (months, days) => {
    expect(entitlementFor({ kind: "perYear", days: 25, prorate: true }, months)).toBe(days);
  });

  it("is not pro-rated when the rule says so", () => {
    expect(entitlementFor({ kind: "perYear", days: 3, prorate: false }, 6)).toBe(3);
  });
});

describe("annual balance", () => {
  it("is the full entitlement with nothing taken", () => {
    expect(annual2026()).toMatchObject({ kind: "pool", entitlement: 25, used: 0, pending: 0, left: 25 });
  });

  it("counts approved and pending leave, and ignores declined and cancelled", () => {
    const requests = [
      request({ startDate: "2026-10-12", endDate: "2026-10-14" }), // 3 approved
      request({ startDate: "2026-11-09", endDate: "2026-11-11", status: "pending" }), // 2 pending (11th is a holiday)
      request({ startDate: "2026-12-01", endDate: "2026-12-04", status: "declined" }),
      request({ startDate: "2026-12-07", endDate: "2026-12-07", status: "cancelled" }),
      request({ startDate: "2026-10-19", endDate: "2026-10-19", leaveType: "sick" }),
    ];
    expect(annual2026(longServing, requests)).toMatchObject({ entitlement: 25, used: 3, pending: 2, left: 20 });
  });

  it("returns days when a pending request is declined, and takes them again if that is undone", () => {
    const pending = request({ startDate: "2026-10-12", endDate: "2026-10-16", status: "pending" });
    expect(annual2026(longServing, [pending])).toMatchObject({ left: 20 });
    expect(annual2026(longServing, [{ ...pending, status: "declined" }])).toMatchObject({ left: 25 });
    expect(annual2026(longServing, [{ ...pending, status: "pending" }])).toMatchObject({ left: 20 });
  });

  it("charges only this year's share of a request over New Year", () => {
    const overNewYear = request({ startDate: "2026-12-30", endDate: "2027-01-08" });
    expect(annual2026(longServing, [overNewYear])).toMatchObject({ used: 2 });
  });

  it("is pro-rated for someone who joined mid-year", () => {
    expect(annual2026({ startDate: "2026-03-16", endDate: null })).toMatchObject({ entitlement: 19, left: 19 });
  });

  it("is unchanged this year by a rule change dated next year", () => {
    const rows: RuleRow[] = [
      ...V1_LEAVE_RULE_ROWS,
      {
        ...(V1_LEAVE_RULE_ROWS.find((row) => row.key === "leave_policy" && row.employmentType === "full_time") as RuleRow),
        id: "test:policy-2027",
        effectiveFrom: "2027-01-01",
        value: {
          types: {
            annual: { allowance: { kind: "per_year", days: 30, prorate: true }, count: "working", half_days: true, paid: true },
          },
        },
      },
    ];
    expect(annual2026(longServing, [], rows)).toMatchObject({ entitlement: 25 });
    expect(balanceFor({ leaveType: "annual", year: 2027, employmentType: "full_time", person: longServing, requests: [], ruleRows: rows, calendar })).toMatchObject({
      entitlement: 30,
    });
  });
});

describe("interns", () => {
  it("are not offered annual leave", () => {
    expect(annual2026(longServing, [], V1_LEAVE_RULE_ROWS, "intern")).toEqual({ kind: "notOffered" });
  });

  it("get the intern sick leave, pro-rated", () => {
    const intern = { startDate: "2026-03-16", endDate: null };
    expect(
      balanceFor({ leaveType: "sick", year: 2026, employmentType: "intern", person: intern, requests: [], ruleRows: V1_LEAVE_RULE_ROWS, calendar }),
    ).toMatchObject({ kind: "pool", entitlement: 10.5 });
  });

  it("have special leave as approval only, with no allowance", () => {
    expect(
      balanceFor({ leaveType: "bereavement", year: 2026, employmentType: "intern", person: longServing, requests: [], ruleRows: V1_LEAVE_RULE_ROWS, calendar }),
    ).toMatchObject({ kind: "noLimit" });
  });
});

describe("per-event leave", () => {
  it("allows maternity by child order", () => {
    const facts = { year: 2026, employmentType: "full_time" as const, person: longServing, requests: [], ruleRows: V1_LEAVE_RULE_ROWS, calendar };
    expect(balanceFor({ ...facts, leaveType: "maternity", childOrder: "first_or_second" })).toEqual({ kind: "perEvent", allowance: 180, count: "calendar" });
    expect(balanceFor({ ...facts, leaveType: "maternity", childOrder: "later" })).toEqual({ kind: "perEvent", allowance: 90, count: "calendar" });
    expect(balanceFor({ ...facts, leaveType: "bereavement" })).toEqual({ kind: "perEvent", allowance: 7, count: "working" });
  });
});
