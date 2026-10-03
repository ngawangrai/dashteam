import { Banknote, CalendarX2, ListPlus, type LucideIcon, TrendingDown, TrendingUp, UserMinus, UserPlus } from "lucide-react";
import { Icon } from "@/components/icon";
import type { ExceptionKind, RunException } from "@/modules/run/exceptions";

const ICONS: Record<ExceptionKind, LucideIcon> = {
  new_joiner: UserPlus,
  leaver: UserMinus,
  unpaid_leave: CalendarX2,
  one_offs: ListPlus,
  pay_change: Banknote,
  large_change: TrendingUp,
};

/** What makes this month different for a person: always words beside an icon, never colour alone. */
export function ExceptionBadges({ exceptions }: { exceptions: RunException[] }) {
  if (!exceptions.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {exceptions.map((exception) => (
        <li key={exception.kind} className="inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-caption text-label-secondary">
          <Icon icon={exception.kind === "large_change" && exception.label.includes("down") ? TrendingDown : ICONS[exception.kind]} size={14} />
          {exception.label}
        </li>
      ))}
    </ul>
  );
}
