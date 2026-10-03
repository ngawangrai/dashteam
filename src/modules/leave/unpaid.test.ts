import { describe, expect, it } from "vitest";
import { calculatePay } from "@/modules/payroll";
import { resolveRules } from "@/modules/rules/resolve";
import { V1_RULE_ROWS } from "@/modules/rules/v1";
import type { LeaveRequestFacts } from "./balance";
import { unpaidLeaveDays } from "./unpaid";

const calendar = { workingWeek: [1, 2, 3, 4, 5], holidays: ["2026-11-11"] };
const unpaid = (startDate: string, endDate: string, fields: Partial<LeaveRequestFacts> = {}): LeaveRequestFacts => ({
  id: `${startDate}-${endDate}`,
  leaveType: "unpaid",
  status: "approved",
  startDate,
  endDate,
  startHalf: false,
  endHalf: false,
  childOrder: null,
  ...fields,
});

const requests = [
  unpaid("2026-10-29", "2026-11-03"), // Thu 29, Fri 30 Oct | Mon 2, Tue 3 Nov
  unpaid("2026-11-05", "2026-11-05", { startHalf: true }), // half of Thu 5 Nov
  unpaid("2026-11-09", "2026-11-13", { status: "pending" }), // not approved: not counted
  unpaid("2026-11-16", "2026-11-17", { leaveType: "annual" }), // paid leave: not counted
];

describe("unpaid leave days for payroll", () => {
  it("splits a request over two months", () => {
    expect(unpaidLeaveDays(requests, { year: 2026, month: 10 }, calendar)).toBe(2);
    expect(unpaidLeaveDays(requests, { year: 2026, month: 11 }, calendar)).toBe(2.5);
  });

  it("is zero in a month without unpaid leave", () => {
    expect(unpaidLeaveDays(requests, { year: 2026, month: 12 }, calendar)).toBe(0);
  });

  it("feeds the payroll calculation as it is", () => {
    const month = { year: 2026, month: 10 };
    const result = calculatePay(
      {
        employmentType: "full_time",
        month,
        regularPay: { kind: "salary", basic: 3_000_000, allowances: 100_000 },
        unpaidLeaveDays: unpaidLeaveDays(requests, month, calendar),
        lines: [],
        recoveries: [],
      },
      resolveRules(V1_RULE_ROWS, "full_time", month),
    );
    // 31,000 × 29 / 31 = 29,000
    expect(result.regularPayDue).toBe(2_900_000);
  });
});
