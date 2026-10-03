import { describe, expect, it } from "vitest";
import { bankListCsv } from "./bank-list";
import { lockedMessage, lockedMonthsIn } from "./locked";

describe("refusals inside a locked month", () => {
  const error = new Error("October 2026 payroll is locked. [payroll_locked:2026-10:2026-11]");

  it("read the locked month and the month to correct in from the database's refusal", () => {
    expect(lockedMonthsIn(error)).toEqual({ locked: { year: 2026, month: 10 }, draft: { year: 2026, month: 11 } });
    // Drizzle wraps the database error; the text is on the cause.
    expect(lockedMonthsIn(Object.assign(new Error("Failed query"), { cause: error }))).toMatchObject({ locked: { year: 2026, month: 10 } });
    expect(lockedMonthsIn(new Error("something else"))).toBeNull();
  });

  it("tell an admin what to do instead", () => {
    expect(lockedMessage(lockedMonthsIn(error), "admin")).toBe(
      "October 2026 payroll is locked, so this can’t change. Add a correction to November’s payroll instead.",
    );
  });

  it("tell an employee who to ask", () => {
    expect(lockedMessage(lockedMonthsIn(error), "employee")).toBe("October payroll is locked. Ask your admin to add a correction.");
  });
});

describe("the bank transfer list", () => {
  it("lists name, bank, account number and amount, with amounts as plain numbers", () => {
    const csv = bankListCsv([
      { name: "Sonam Wangmo", bank: "Bank of Bhutan", account: "200123456", takeHome: 4_159_200 },
      { name: "Pema Choden", bank: null, account: null, takeHome: 2_443_005 },
    ]);
    expect(csv).toBe(
      ["Name,Bank,Account number,Amount (Nu.)", "Sonam Wangmo,Bank of Bhutan,200123456,41592.00", "Pema Choden,,,24430.05"].join("\r\n") + "\r\n",
    );
  });

  it("quotes commas and quotes, and never lets a cell start a formula", () => {
    const csv = bankListCsv([{ name: '=HYPERLINK("x"), Karma', bank: "T Bank", account: "0012", takeHome: 100 }]);
    expect(csv.split("\r\n")[1]).toBe(`"'=HYPERLINK(""x""), Karma",T Bank,0012,1.00`);
  });
});
