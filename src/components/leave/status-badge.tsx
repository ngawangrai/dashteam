import { CircleCheck, CircleSlash, CircleX, Clock } from "lucide-react";
import { Icon } from "@/components/icon";
import type { LeaveStatus } from "@/modules/leave/balance";
import { LEAVE_STATUS_NAME } from "@/modules/leave/labels";

const look = {
  pending: { icon: Clock, className: "text-warning" },
  approved: { icon: CircleCheck, className: "text-success" },
  declined: { icon: CircleX, className: "text-danger" },
  cancelled: { icon: CircleSlash, className: "text-label-secondary" },
} as const;

/** Status in words with an icon, never by colour alone. */
export function StatusBadge({ status }: { status: LeaveStatus }) {
  const { icon, className } = look[status];
  return (
    <span className={`inline-flex items-center gap-1 text-secondary ${className}`}>
      <Icon icon={icon} size={16} />
      {LEAVE_STATUS_NAME[status]}
    </span>
  );
}
