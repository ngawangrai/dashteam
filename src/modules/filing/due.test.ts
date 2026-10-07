import { describe, expect, it } from "vitest";
import { thimphuToday } from "@/lib/format";
import { daysUntil, dueDateFor, dueStatus, monthsToFile, remindersToday } from "./due";

// TDS for month M is due on the 10th of M+1, in Asia/Thimphu. Days are counted on calendar dates,
// never on UTC instants, so month ends, leap years and the time zone can't shift them.

describe("the due date", () => {
  it("is the due day of the following month", () => {
    expect(dueDateFor({ year: 2026, month: 10 }, 10)).toBe("2026-11-10");
    expect(dueDateFor({ year: 2026, month: 12 }, 10)).toBe("2027-01-10");
  });
});

describe("days until it's due", () => {
  it.each([
    ["across a month end", "2026-10-31", "2026-11-10", 10],
    ["across a year end", "2026-12-25", "2027-01-10", 16],
    ["through a leap day", "2028-02-28", "2028-03-10", 11],
    ["through a non-leap February", "2027-02-28", "2027-03-10", 10],
    ["on the day", "2026-11-10", "2026-11-10", 0],
    ["after it", "2026-11-12", "2026-11-10", -2],
  ])("%s", (_label, today, due, days) => {
    expect(daysUntil(today, due)).toBe(days);
  });

  it("uses Thimphu's date: at 00:30 in Thimphu it's already the 10th, though UTC still says the 9th", () => {
    const now = new Date("2026-11-09T18:30:00Z");
    expect(now.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(dueStatus(thimphuToday(now), "2026-11-10")).toEqual({ kind: "today" });
  });

  it("reads as upcoming, today or overdue, and soon from three days out", () => {
    expect(dueStatus("2026-11-05", "2026-11-10")).toEqual({ kind: "upcoming", days: 5, soon: false });
    expect(dueStatus("2026-11-07", "2026-11-10")).toEqual({ kind: "upcoming", days: 3, soon: true });
    expect(dueStatus("2026-11-10", "2026-11-10")).toEqual({ kind: "today" });
    expect(dueStatus("2026-11-12", "2026-11-10")).toEqual({ kind: "overdue", days: 2 });
  });
});

describe("which months need filing", () => {
  const first = { year: 2026, month: 9 };

  it("from the 1st, last month needs filing until it's filed", () => {
    expect(monthsToFile("2026-11-01", first, [])).toEqual([{ year: 2026, month: 9 }, { year: 2026, month: 10 }]);
    expect(monthsToFile("2026-11-01", first, [{ year: 2026, month: 9 }])).toEqual([{ year: 2026, month: 10 }]);
    expect(monthsToFile("2026-11-01", first, [{ year: 2026, month: 9 }, { year: 2026, month: 10 }])).toEqual([]);
  });

  it("never includes this month, or months before DashTeam's first", () => {
    expect(monthsToFile("2026-10-20", { year: 2026, month: 10 }, [])).toEqual([]);
    expect(monthsToFile("2026-11-03", { year: 2026, month: 10 }, [])).toEqual([{ year: 2026, month: 10 }]);
    expect(monthsToFile("2026-11-03", null, [])).toEqual([]);
  });
});

describe("reminders", () => {
  const october = { month: { year: 2026, month: 10 }, dueDate: "2026-11-10" };

  it("go on the configured days only", () => {
    expect(remindersToday("2026-11-05", [5, 8, 10], [october])).toEqual([october]);
    expect(remindersToday("2026-11-06", [5, 8, 10], [october])).toEqual([]);
    expect(remindersToday("2026-11-10", [5, 8, 10], [october])).toEqual([october]);
    expect(remindersToday("2026-11-06", [6], [october])).toEqual([october]);
  });

  it("stop once nothing is left to file", () => {
    expect(remindersToday("2026-11-08", [5, 8, 10], [])).toEqual([]);
  });
});
