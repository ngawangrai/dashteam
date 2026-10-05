import { describe, expect, it } from "vitest";
import { leaveDecidedEmail, leaveRequestedEmail, payslipEmail } from "./emails";

// Emails read like a helpful person wrote them: short, specific, no em dashes, no exclamation marks.

const all = [
  payslipEmail({ firstName: "Sonam", monthName: "October 2026", takeHome: 4_196_700, adminFirstName: "Tashi", reason: "issued" }),
  payslipEmail({ firstName: "Sonam", monthName: "October 2026", takeHome: 4_196_700, adminFirstName: "Tashi", reason: "asked" }),
  leaveRequestedEmail({ personName: "Sonam Wangmo", leaveType: "annual", days: 3, startDate: "2026-10-07", endDate: "2026-10-09", note: "Family visit", url: "https://dashteam.example/admin" }),
  leaveDecidedEmail({ firstName: "Sonam", decision: "approved", leaveType: "annual", days: 3, startDate: "2026-10-07", endDate: "2026-10-09", note: "", adminFirstName: "Tashi", url: "https://dashteam.example/leave" }),
  leaveDecidedEmail({ firstName: "Sonam", decision: "declined", leaveType: "unpaid", days: 1, startDate: "2026-10-07", endDate: "2026-10-07", note: "Busy week", adminFirstName: "Tashi", url: "https://dashteam.example/leave" }),
];

describe("the payslip email", () => {
  it("says what's attached and the take-home, and who to ask", () => {
    const [issued] = all;
    expect(issued?.subject).toBe("Your October 2026 payslip");
    expect(issued?.text).toContain("Hi Sonam, your payslip for October 2026 is attached.");
    expect(issued?.text).toContain("Take-home: Nu. 41,967");
    expect(issued?.text).toContain("If anything looks wrong, let Tashi know.");
  });

  it("says it was asked for when someone emails it to themselves", () => {
    expect(all[1]?.text).toContain("Here’s your payslip for October 2026, as you asked.");
  });
});

describe("leave emails", () => {
  it("tell the admin who asked for what, with a way in", () => {
    expect(all[2]?.subject).toBe("Sonam asked for 3 days of annual leave");
    expect(all[2]?.text).toContain("Sonam Wangmo asked for 3 days of annual leave, Wed 7 – Fri 9 Oct.");
    expect(all[2]?.text).toContain("Their note: Family visit");
    expect(all[2]?.text).toContain("https://dashteam.example/admin");
  });

  it("tell the person it's approved, or declined with the note", () => {
    expect(all[3]?.subject).toBe("Your annual leave is approved");
    expect(all[3]?.text).toContain("Hi Sonam, your annual leave on Wed 7 – Fri 9 Oct is approved (3 days).");
    expect(all[4]?.subject).toBe("Your unpaid leave wasn’t approved");
    expect(all[4]?.text).toContain("your unpaid leave on Wed 7 Oct was declined.");
    expect(all[4]?.text).toContain("Tashi’s note: Busy week");
  });
});

describe("every email", () => {
  it.each(all.map((email, i) => [i, email] as const))("%i has no em dashes or exclamation marks", (_i, email) => {
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toContain("—");
      // The words people read: not the doctype, and not CSS (!important is code, not copy).
      expect(part.replace(/<!DOCTYPE html>|<!--[\s\S]*?-->|<style>[\s\S]*?<\/style>/g, "")).not.toContain("!");
    }
  });

  it("works in light and dark mail apps, and escapes what people typed", () => {
    const email = leaveRequestedEmail({ personName: "Sonam <b>Wangmo</b>", leaveType: "annual", days: 1, startDate: "2026-10-07", endDate: "2026-10-07", note: "<script>x</script>", url: "https://dashteam.example/admin" });
    expect(email.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<b>Wangmo</b>");
  });
});
