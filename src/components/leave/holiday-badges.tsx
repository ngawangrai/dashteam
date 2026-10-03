import { Clock } from "lucide-react";
import { Icon } from "@/components/icon";
import type { Holiday } from "@/modules/leave/holidays";

const KIND = { fixed: "Fixed date", lunar: "Lunar", one_off: "One-off" } as const;

/** "Tentative" always shows as a word with an icon, never by colour alone. */
export function TentativeBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-secondary text-warning">
      <Icon icon={Clock} size={14} />
      Tentative
    </span>
  );
}

export function HolidayBadges({ holiday }: { holiday: Pick<Holiday, "status" | "scope" | "kind"> }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-secondary text-label-secondary">
      {holiday.status === "tentative" ? <TentativeBadge /> : null}
      {holiday.scope === "thimphu" ? <span>Thimphu</span> : null}
      <span>{KIND[holiday.kind]}</span>
    </span>
  );
}
