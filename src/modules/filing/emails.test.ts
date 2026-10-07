import { describe, expect, it } from "vitest";
import { filingReminderEmail } from "./emails";

// The reminder says which month, how much, by when, and what to do. No em dashes, no exclamation marks.

const october = { month: { year: 2026, month: 10 }, dueDate: "2026-11-10", remit: 1_297_100, locked: true };

describe("the filing reminder", () => {
  it("names the month, the amount and the days left", () => {
    const email = filingReminderEmail({ today: "2026-11-05", months: [october], url: "https://dashteam.example/admin/payroll/2026-10/filing" });
    expect(email.subject).toBe("October TDS is due in 5 days");
    expect(email.text).toContain("October’s TDS and HC need filing with DRC by 10 November.");
    expect(email.text).toContain("To pay: Nu. 12,971");
    expect(email.text).toContain("https://dashteam.example/admin/payroll/2026-10/filing");
    expect(email.text).toContain("Reminders stop once you mark it filed.");
  });

  it("says when it's due today", () => {
    expect(filingReminderEmail({ today: "2026-11-10", months: [october], url: "x" }).subject).toBe("October TDS is due today");
  });

  it("asks for the lock first when the month isn't locked yet", () => {
    const email = filingReminderEmail({ today: "2026-11-05", months: [{ ...october, locked: false, remit: null }], url: "x" });
    expect(email.text).toContain("Lock October payroll first, then file it.");
    expect(email.text).not.toContain("To pay");
  });

  it("lists every month still to file, overdue ones first", () => {
    const september = { month: { year: 2026, month: 9 }, dueDate: "2026-10-10", remit: 1_200_000, locked: true };
    const email = filingReminderEmail({ today: "2026-11-05", months: [september, october], url: "x" });
    expect(email.subject).toBe("TDS for 2 months needs filing");
    expect(email.text).toContain("September: Nu. 12,000, overdue by 26 days.");
    expect(email.text).toContain("October: Nu. 12,971, due in 5 days.");
  });

  it("has no em dashes or exclamation marks in what people read", () => {
    const email = filingReminderEmail({ today: "2026-11-05", months: [october], url: "x" });
    for (const part of [email.subject, email.text, email.html.replace(/<!DOCTYPE html>|<style>[\s\S]*?<\/style>/g, "")]) {
      expect(part).not.toContain("—");
      expect(part).not.toContain("!");
    }
  });
});
