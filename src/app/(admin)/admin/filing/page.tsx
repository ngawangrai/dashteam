import { CircleAlert, CircleCheck, CircleDashed, Clock, FileText, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icon";
import { InsetSection } from "@/components/inset-section";
import { Money } from "@/components/money";
import { Page } from "@/components/page";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatLongDate, formatMonth } from "@/lib/format";
import { dueStatus } from "@/modules/filing/due";
import { dueWords } from "@/modules/filing/emails";
import { type FilingMonthView, filingHistory, filingToday } from "@/modules/filing/repository";

export const metadata = { title: "TDS filing" };

function stateOf(row: FilingMonthView, today: string): { icon: LucideIcon; className: string; words: string } {
  if (row.state === "filed") {
    return { icon: CircleCheck, className: "text-success", words: `Filed ${formatDate(row.filedOn ?? "")}${row.acknowledgementNumber ? ` · ${row.acknowledgementNumber}` : row.receipt ? " · receipt kept" : ""}` };
  }
  const status = dueStatus(today, row.dueDate);
  const due = status.kind === "upcoming" ? `due ${formatLongDate(row.dueDate).replace(/ \d{4}$/, "")}` : dueWords(status);
  if (status.kind === "overdue") return { icon: CircleAlert, className: "text-danger", words: `${row.state === "draft" ? "Not locked" : "Not filed"}, ${due}` };
  if (row.state === "draft") return { icon: CircleDashed, className: "text-label-secondary", words: `Not locked yet, ${due}` };
  return { icon: Clock, className: status.kind === "today" || status.soon ? "text-warning" : "text-label-secondary", words: `Ready to file, ${due}` };
}

/** Every month's TDS filing, newest first: where it stands, what was paid, and its acknowledgement. */
export default async function FilingHistoryPage() {
  const admin = await requireRole("admin");
  const [months, today] = [await filingHistory(admin), filingToday()];

  return (
    <Page title="TDS filing" back={{ href: "/admin/payroll", label: "Payroll" }}>
      {months.length ? (
        <InsetSection footer="TDS and HC for each month are due with DRC by the 10th of the next.">
          <ul>
            {months.map((row) => {
              const look = stateOf(row, today);
              return (
                <li key={row.monthKey} className="border-b border-separator/60 last:border-b-0">
                  <Link href={`/admin/payroll/${row.monthKey}/filing`} className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-fill/60 active:bg-fill">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body">{formatMonth(row.month, { withYear: true })}</span>
                      <span className={`inline-flex items-center gap-1 text-secondary ${look.className}`}>
                        <Icon icon={look.icon} size={16} className="shrink-0" />
                        <span className="truncate">{look.words.charAt(0).toUpperCase() + look.words.slice(1)}</span>
                      </span>
                    </span>
                    {row.remit !== null ? <Money amount={row.remit} className="text-body text-label-secondary" /> : null}
                    <Icon icon={ChevronRight} size={18} className="shrink-0 text-label-secondary" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </InsetSection>
      ) : (
        <InsetSection>
          <EmptyState icon={FileText} title="No months to file yet" message="A month shows up here once DashTeam starts paying, and is ready to file once it’s locked." />
        </InsetSection>
      )}
    </Page>
  );
}
