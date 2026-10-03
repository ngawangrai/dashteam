import { describe, expect, it } from "vitest";
import { V1_LEAVE_RULE_ROWS } from "@/modules/rules/v1";
import type { LeaveRequestFacts } from "./balance";
import { countLeaveDays } from "./days";
import {
  type Holiday,
  type ImpactRequest,
  copyFixedHolidays,
  expandHolidays,
  holidayImpact,
  holidayLabel,
  holidaysByDate,
  needsHolidayReminder,
  tentativeDates,
} from "./holidays";
import { V1_HOLIDAYS } from "./holidays-v1";

const WEEK = [1, 2, 3, 4, 5];

function holiday(fields: Partial<Holiday> & Pick<Holiday, "name" | "startDate">): Holiday {
  return {
    endDate: fields.startDate,
    year: Number(fields.startDate.slice(0, 4)),
    kind: "lunar",
    scope: "national",
    status: "confirmed",
    source: "test",
    note: "",
    ...fields,
  };
}

function request(fields: Partial<ImpactRequest> & Pick<LeaveRequestFacts, "startDate" | "endDate">): ImpactRequest {
  return {
    id: `${fields.startDate}-${fields.leaveType ?? "annual"}`,
    leaveType: "annual",
    status: "approved",
    startHalf: false,
    endHalf: false,
    childOrder: null,
    personId: "p1",
    personName: "Sonam Wangmo",
    employmentType: "full_time",
    ...fields,
  };
}

// Thimphu Tshechu 2027 as seeded: Sun 10 – Tue 12 October (tentative).
const tshechu = holiday({ name: "Thimphu Tshechu", startDate: "2027-10-10", endDate: "2027-10-12", status: "tentative", scope: "thimphu" });

describe("expanding holidays", () => {
  it("covers every day of a multi-day holiday", () => {
    expect(expandHolidays([tshechu])).toEqual(["2027-10-10", "2027-10-11", "2027-10-12"]);
  });

  it("lists a date once even when two holidays share it", () => {
    const shared = [holiday({ name: "Descending Day", startDate: "2026-11-01" }), holiday({ name: "Coronation", startDate: "2026-11-01", kind: "fixed" })];
    expect(expandHolidays(shared)).toEqual(["2026-11-01"]);
    expect(holidaysByDate(shared)["2026-11-01"]?.map((h) => h.name)).toEqual(["Descending Day", "Coronation"]);
  });

  it("counts leave over a multi-day holiday correctly", () => {
    // Fri 8 – Wed 13 October 2027: Fri 8, (Sat, Sun), (Mon 11, Tue 12 Tshechu), Wed 13 → 2 days
    const calendar = { workingWeek: WEEK, holidays: expandHolidays([tshechu]) };
    expect(countLeaveDays({ startDate: "2027-10-08", endDate: "2027-10-13", startHalf: false, endHalf: false }, calendar, "working").total).toBe(2);
  });
});

describe("tentative holidays", () => {
  it("are labelled as tentative", () => {
    expect(holidayLabel(tshechu)).toBe("Thimphu Tshechu (tentative)");
    expect(holidayLabel({ ...tshechu, status: "confirmed" })).toBe("Thimphu Tshechu");
  });

  it("make a date tentative only if no confirmed holiday covers it", () => {
    const confirmedSameDay = holiday({ name: "Other", startDate: "2027-10-11" });
    expect(tentativeDates([tshechu])).toEqual(["2027-10-10", "2027-10-11", "2027-10-12"]);
    expect(tentativeDates([tshechu, confirmedSameDay])).toEqual(["2027-10-10", "2027-10-12"]);
  });
});

describe("impact of a holiday change", () => {
  const requests = [
    request({ startDate: "2027-10-11", endDate: "2027-10-13" }), // Mon 11 – Wed 13
    request({ startDate: "2027-10-04", endDate: "2027-10-05", personName: "Pema Choden", personId: "p2" }), // Mon 4 – Tue 5
    request({ startDate: "2027-10-11", endDate: "2027-10-11", status: "declined" }),
    request({ startDate: "2027-10-01", endDate: "2027-10-31", leaveType: "maternity", personId: "p3", personName: "Karma Dema" }),
  ];

  it("shows leave counted before and after a holiday moves", () => {
    // Tshechu moves from 10–12 Oct to 4–6 Oct.
    const moved = { ...tshechu, startDate: "2027-10-04", endDate: "2027-10-06" };
    const changes = holidayImpact({ requests, ruleRows: V1_LEAVE_RULE_ROWS, workingWeek: WEEK, before: [tshechu], after: [moved] });
    expect(changes).toEqual([
      expect.objectContaining({ personName: "Pema Choden", startDate: "2027-10-04", before: 2, after: 0 }),
      expect.objectContaining({ personName: "Sonam Wangmo", startDate: "2027-10-11", before: 1, after: 3 }),
    ]);
  });

  it("ignores declined requests and calendar-day leave like maternity", () => {
    const changes = holidayImpact({ requests, ruleRows: V1_LEAVE_RULE_ROWS, workingWeek: WEEK, before: [tshechu], after: [] });
    expect(changes.map((change) => change.personName)).toEqual(["Sonam Wangmo"]);
  });

  it("finds nothing when a holiday falls on a weekend", () => {
    const sunday = holiday({ name: "Sunday holiday", startDate: "2027-10-10" });
    const changes = holidayImpact({
      requests: [request({ startDate: "2027-10-08", endDate: "2027-10-13" })],
      ruleRows: V1_LEAVE_RULE_ROWS,
      workingWeek: WEEK,
      before: [],
      after: [sunday],
    });
    expect(changes).toEqual([]);
  });
});

describe("copying fixed holidays forward", () => {
  it("copies fixed holidays only, as tentative, and skips ones already there", () => {
    const from = V1_HOLIDAYS.filter((h) => h.year === 2026);
    const existing = [holiday({ name: "National Day", startDate: "2028-12-17", kind: "fixed" })];
    const { copies, skipped } = copyFixedHolidays([...from, ...existing], 2026, 2028);
    expect(copies.map((h) => h.name)).toEqual([
      "Winter Solstice (Nyilo)",
      "Birth Anniversary of His Majesty the King",
      "Birth Anniversary of the Third Druk Gyalpo",
      "Coronation of His Majesty the King",
      "Birth Anniversary of the Fourth Druk Gyalpo",
    ]);
    expect(copies.every((h) => h.kind === "fixed" && h.status === "tentative" && h.year === 2028)).toBe(true);
    expect(copies.find((h) => h.name.startsWith("Birth Anniversary of His Majesty"))).toMatchObject({ startDate: "2028-02-21", endDate: "2028-02-23" });
    expect(skipped).toEqual([{ name: "National Day", reason: "Already in 2028." }]);
  });

  it("never copies lunar or one-off holidays", () => {
    const { copies } = copyFixedHolidays([tshechu, holiday({ name: "Short notice", startDate: "2027-03-03", kind: "one_off" })], 2027, 2028);
    expect(copies).toEqual([]);
  });

  it("leaves out a 29 February that doesn't exist next year", () => {
    const leap = holiday({ name: "Leap day", startDate: "2028-02-29", kind: "fixed" });
    expect(copyFixedHolidays([leap], 2028, 2029)).toEqual({ copies: [], skipped: [{ name: "Leap day", reason: "29 February isn’t in 2029." }] });
  });
});

describe("the reminder to confirm next year", () => {
  it("starts on 1 November", () => {
    expect(needsHolidayReminder("2026-10-31", 0)).toBe(false);
    expect(needsHolidayReminder("2026-11-01", 0)).toBe(true);
    expect(needsHolidayReminder("2026-12-31", 0)).toBe(true);
  });

  it("stops once next year has a confirmed holiday", () => {
    expect(needsHolidayReminder("2026-11-15", 1)).toBe(false);
  });
});

describe("the seeded holidays", () => {
  it("are confirmed for 2026 and tentative for 2027, each with a source", () => {
    expect(V1_HOLIDAYS.filter((h) => h.year === 2026 && h.status === "confirmed")).toHaveLength(17);
    expect(V1_HOLIDAYS.filter((h) => h.year === 2027 && h.status === "tentative")).toHaveLength(17);
    expect(V1_HOLIDAYS.every((h) => h.source.startsWith("https://"))).toBe(true);
    expect(V1_HOLIDAYS.every((h) => h.startDate.startsWith(String(h.year)) && h.endDate >= h.startDate)).toBe(true);
  });
});
