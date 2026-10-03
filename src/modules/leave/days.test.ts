import { describe, expect, it } from "vitest";
import { countLeaveDays, daysByMonth, daysInYear } from "./days";

// Monday to Friday, with the King's birth anniversary (Wednesday 11 November 2026) as a holiday.
const calendar = { workingWeek: [1, 2, 3, 4, 5], holidays: ["2026-11-11"] };
const span = (startDate: string, endDate: string, startHalf = false, endHalf = false) =>
  ({ startDate, endDate, startHalf, endHalf }) as Parameters<typeof countLeaveDays>[0];

describe("counting working days", () => {
  it("skips the weekend inside a request", () => {
    // Fri 9, Sat 10, Sun 11, Mon 12, Tue 13 October
    expect(countLeaveDays(span("2026-10-09", "2026-10-13"), calendar, "working").total).toBe(3);
  });

  it("skips a holiday inside a request", () => {
    // Mon 9 to Fri 13 November, Wednesday 11 is a holiday
    expect(countLeaveDays(span("2026-11-09", "2026-11-13"), calendar, "working").total).toBe(4);
  });

  it("skips a weekend and a holiday in the same request", () => {
    // Fri 6, (Sat 7, Sun 8), Mon 9, Tue 10, (Wed 11 holiday)
    const result = countLeaveDays(span("2026-11-06", "2026-11-11"), calendar, "working");
    expect(result.total).toBe(3);
    expect(result.byDate.filter((day) => day.days === 0).map((day) => day.reason)).toEqual(["weekend", "weekend", "holiday"]);
  });

  it("counts a first day taken in the afternoon only as half", () => {
    expect(countLeaveDays(span("2026-10-09", "2026-10-12", true), calendar, "working").total).toBe(1.5);
  });

  it("counts a last day taken in the morning only as half", () => {
    expect(countLeaveDays(span("2026-10-12", "2026-10-13", false, true), calendar, "working").total).toBe(1.5);
  });

  it("counts a single half day", () => {
    expect(countLeaveDays(span("2026-10-12", "2026-10-12", true), calendar, "working").total).toBe(0.5);
  });

  it("counts nothing for a half day on a weekend", () => {
    expect(countLeaveDays(span("2026-10-10", "2026-10-10", true), calendar, "working").total).toBe(0);
  });

  it("refuses a single day that is both a morning and an afternoon", () => {
    expect(() => countLeaveDays(span("2026-10-12", "2026-10-12", true, true), calendar, "working")).toThrow();
  });

  it("refuses an end before the start", () => {
    expect(() => countLeaveDays(span("2026-10-13", "2026-10-12"), calendar, "working")).toThrow();
  });
});

describe("counting calendar days", () => {
  it("counts every day, weekends and holidays included (maternity)", () => {
    expect(countLeaveDays(span("2026-11-01", "2026-11-30"), calendar, "calendar").total).toBe(30);
  });
});

describe("splitting a request", () => {
  it("splits across two months", () => {
    // Thu 29, Fri 30 October; Mon 2, Tue 3 November
    const { byDate } = countLeaveDays(span("2026-10-29", "2026-11-03"), calendar, "working");
    expect(daysByMonth(byDate)).toEqual({ "2026-10": 2, "2026-11": 2 });
  });

  it("splits across New Year, charging each leave year its own days", () => {
    // Wed 30, Thu 31 December 2026; Fri 1, Mon 4 to Fri 8 January 2027
    const { byDate, total } = countLeaveDays(span("2026-12-30", "2027-01-08"), calendar, "working");
    expect(total).toBe(8);
    expect(daysInYear(byDate, 2026)).toBe(2);
    expect(daysInYear(byDate, 2027)).toBe(6);
  });
});
