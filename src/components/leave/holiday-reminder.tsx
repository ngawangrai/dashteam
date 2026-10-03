import { CalendarClock } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";

/** From 1 November, while next year has no confirmed holidays. */
export function HolidayReminder({ year }: { year: number }) {
  return (
    <Link
      href={`/admin/calendar/holidays?year=${year}` as Route}
      className="flex items-start gap-3 rounded-card bg-surface px-4 py-3 transition-colors duration-150 hover:bg-fill/60"
    >
      <Icon icon={CalendarClock} size={22} className="mt-0.5 shrink-0 text-warning" />
      <span className="flex flex-col">
        <span className="text-body font-semibold">{year} holidays aren’t confirmed yet</span>
        <span className="text-secondary text-pretty text-label-secondary">When the Ministry publishes the list, confirm them in Holidays.</span>
      </span>
    </Link>
  );
}
