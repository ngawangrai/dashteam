import type { LeaveType } from "@/modules/rules/types";

export const LEAVE_TYPE_NAME: Record<LeaveType, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  professional_development: "Professional development",
  maternity: "Maternity leave",
  paternity: "Paternity leave",
  bereavement: "Bereavement leave",
  family_emergency: "Family emergency",
  unpaid: "Unpaid leave",
};

export const LEAVE_STATUS_NAME = { pending: "Waiting for approval", approved: "Approved", declined: "Declined", cancelled: "Cancelled" } as const;
