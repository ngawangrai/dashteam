import type { PayrollMonth } from "@/modules/rules/types";
import type { LeaveRequestFacts } from "./balance";
import { type LeaveCalendar, countLeaveDays, daysByMonth } from "./days";

/**
 * Approved unpaid leave days in one payroll month: the `unpaidLeaveDays` input calculatePay takes.
 * A request over two months gives each month its own days. Unpaid leave counts working days.
 */
export function unpaidLeaveDays(requests: readonly LeaveRequestFacts[], month: PayrollMonth, calendar: LeaveCalendar): number {
  const key = `${month.year}-${String(month.month).padStart(2, "0")}`;
  return requests
    .filter((request) => request.leaveType === "unpaid" && request.status === "approved")
    .reduce((sum, request) => sum + (daysByMonth(countLeaveDays(request, calendar, "working").byDate)[key] ?? 0), 0);
}
