import { describe, expect, it } from "vitest";
import { V1_LEAVE_RULE_ROWS } from "@/modules/rules/v1";
import type { LeaveRequestFacts } from "./balance";
import { exitSettlement } from "./exit";

const calendar = { workingWeek: [1, 2, 3, 4, 5], holidays: [] as string[] };
const annual = (startDate: string, endDate: string): LeaveRequestFacts => ({
  id: startDate,
  leaveType: "annual",
  status: "approved",
  startDate,
  endDate,
  startHalf: false,
  endHalf: false,
  childOrder: null,
});

// Basic 30,000 + allowance 6,000. Leaving on Wednesday 14 October 2026: October doesn't count,
// so 9 months → 25 × 9/12 = 18.75 → 19 days of annual leave.
const base = {
  person: { startDate: "2025-03-03", endDate: "2026-10-14" },
  employmentType: "full_time" as const,
  monthlyPay: 3_600_000,
  ruleRows: V1_LEAVE_RULE_ROWS,
  calendar,
};

// 21 working days of annual leave: Mon 2 Feb – Mon 2 Mar 2026 (5 weeks + 1 day).
const twentyOneDays = [annual("2026-02-02", "2026-03-02")];

describe("leave at exit", () => {
  it("suggests a recovery for leave taken beyond the pro-rated entitlement, with the working", () => {
    const result = exitSettlement({ ...base, requests: twentyOneDays });
    expect(result.types.find((t) => t.leaveType === "annual")).toMatchObject({ entitlement: 19, used: 21, over: 2 });
    expect(result.daysOver).toBe(2);
    // Daily rate: 36,000 ÷ 31 = 1,161.29; 2 × 36,000 ÷ 31 = 2,322.58 → Nu. 2,323
    expect(result.dailyRate).toBe(116_129);
    expect(result.suggested).toBe(232_300);
    expect(result.unusedAnnualDays).toBe(0);
  });

  it("suggests nothing when leave taken is within the entitlement, and shows unused annual days", () => {
    const result = exitSettlement({ ...base, requests: [annual("2026-02-02", "2026-02-13")] }); // 10 days
    expect(result.daysOver).toBe(0);
    expect(result.suggested).toBe(0);
    expect(result.unusedAnnualDays).toBe(9);
  });

  it("calculates no payout for unused days while the payout rule is off", () => {
    expect(exitSettlement({ ...base, requests: [] }).payout).toBeNull();
  });

  it("counts the exit month when they leave on or after the 15th", () => {
    const result = exitSettlement({ ...base, person: { ...base.person, endDate: "2026-10-15" }, requests: twentyOneDays });
    expect(result.types.find((t) => t.leaveType === "annual")).toMatchObject({ entitlement: 21, over: 0 });
  });
});
