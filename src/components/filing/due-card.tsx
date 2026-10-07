import { CircleAlert, Clock, type LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatMonth, formatNu } from "@/lib/format";
import { dueWords } from "@/modules/filing/emails";
import type { DueCard as DueCardData } from "@/modules/filing/repository";

/** The admin home's reminder: which month's TDS needs filing, how much, and how long is left. */
export function DueCard({ due }: { due: DueCardData }) {
  const name = formatMonth(due.month);
  const overdue = due.status.kind === "overdue";
  const urgent = overdue || due.status.kind === "today" || (due.status.kind === "upcoming" && due.status.soon);
  const look: { icon: LucideIcon; className: string } = overdue
    ? { icon: CircleAlert, className: "text-danger" }
    : urgent
      ? { icon: Clock, className: "text-warning" }
      : { icon: Clock, className: "text-label-secondary" };
  const when = dueWords(due.status);
  const detail = due.locked
    ? `${due.remit !== null ? `${formatNu(due.remit)} ` : ""}${when}`
    : `Lock ${name} payroll first. TDS is ${when}.`;

  return (
    <section aria-label="TDS filing">
      <Link href={`/admin/payroll/${due.monthKey}/filing`} className="flex min-h-11 items-center gap-3 rounded-card bg-surface px-4 py-3 transition-colors duration-150 hover:bg-fill/60 active:bg-fill">
        <Icon icon={look.icon} size={24} className={`shrink-0 ${look.className}`} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body font-semibold">{name} TDS</span>
          <span className={`text-secondary tabular ${overdue ? "text-danger" : "text-label-secondary"}`}>{detail.charAt(0).toUpperCase() + detail.slice(1)}</span>
          {due.more ? <span className="text-secondary text-label-secondary">{due.more === 1 ? "1 more month" : `${due.more} more months`} to file after this.</span> : null}
        </span>
        <Icon icon={ChevronRight} size={18} className="shrink-0 text-label-secondary" />
      </Link>
    </section>
  );
}
