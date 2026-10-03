import { describe, expect, it } from "vitest";
import { formatDate, formatDay, formatDays, formatMonth, formatNu, formatPhone, formatSpan, maskedLast4, parseNu } from "./format";

describe("formatNu", () => {
  it.each([
    [0, "Nu. 0"],
    [100, "Nu. 1"],
    [4_000_000, "Nu. 40,000"],
    [12_500_000, "Nu. 1,25,000"],
    [1_000_000_000, "Nu. 1,00,00,000"],
    [45_050, "Nu. 450.50"],
    [-500_000, "−Nu. 5,000"],
  ])("%i chhertum is %s", (chhertum, text) => {
    expect(formatNu(chhertum)).toBe(text);
  });
});

describe("parseNu", () => {
  it.each([
    ["40000", 4_000_000],
    ["40,000", 4_000_000],
    ["1,25,000", 12_500_000],
    [" 450.5 ", 45_050],
    ["450.50", 45_050],
    ["0", 0],
  ])("%j is %i chhertum", (text, chhertum) => {
    expect(parseNu(text)).toBe(chhertum);
  });

  it.each(["", "abc", "-5", "1.234", "1e5", "Nu. 40"])("refuses %j", (text) => {
    expect(parseNu(text)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("groups a Bhutanese number in pairs", () => {
    expect(formatPhone("17112233")).toBe("17 11 22 33");
  });

  it("leaves anything else as it is", () => {
    expect(formatPhone("+97517112233")).toBe("+97517112233");
  });
});

describe("dates", () => {
  it("shows a date the way people write it", () => {
    expect(formatDate("2025-03-03")).toBe("3 Mar 2025");
  });

  it("names a month", () => {
    expect(formatMonth({ year: 2026, month: 11 })).toBe("November");
    expect(formatMonth({ year: 2027, month: 1 }, { withYear: true })).toBe("January 2027");
  });
});

describe("maskedLast4", () => {
  it("shows only the last four", () => {
    expect(maskedLast4("1234")).toBe("••••1234");
  });
});

describe("leave dates", () => {
  it("names a day", () => {
    expect(formatDay("2026-10-07")).toBe("Wed 7 Oct");
    expect(formatDay("2026-10-07", { long: true })).toBe("Wednesday 7 October");
  });

  it("describes a span", () => {
    expect(formatSpan("2026-10-07", "2026-10-07")).toBe("Wed 7 Oct");
    expect(formatSpan("2026-10-07", "2026-10-09")).toBe("Wed 7 – Fri 9 Oct");
    expect(formatSpan("2026-12-30", "2027-01-08")).toBe("Wed 30 Dec – Fri 8 Jan");
  });

  it("counts days in words, with halves", () => {
    expect(formatDays(0.5)).toBe("½ day");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(3.5)).toBe("3½ days");
  });
});
