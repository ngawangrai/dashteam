import { Money } from "@/components/money";
import { formatLongDate } from "@/lib/format";
import type { Chhertum } from "@/modules/rules/types";

type Totals = { people: number; gross: Chhertum; tds: Chhertum; healthContribution: Chhertum; providentFund: Chhertum; takeHome: Chhertum; remit: Chhertum };

/** The month at a glance: take-home first and largest, then what makes it up, then what goes to DRC. */
export function RunTotals({ totals, dueDate, locked = false }: { totals: Totals; dueDate: string; locked?: boolean }) {
  const parts = [
    { label: "Gross", amount: totals.gross },
    { label: "TDS", amount: totals.tds },
    { label: "HC", amount: totals.healthContribution },
    ...(totals.providentFund ? [{ label: "PF", amount: totals.providentFund }] : []),
  ];
  return (
    <section aria-label="Totals" className="flex flex-col gap-4 rounded-card bg-surface p-4">
      <div className="flex flex-col gap-1">
        <span className="text-secondary text-label-secondary">
          Take-home for {totals.people === 1 ? "1 person" : `${totals.people} people`}
        </span>
        <Money amount={totals.takeHome} className="text-large-title" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {parts.map((part) => (
          <div key={part.label} className="flex flex-col">
            <dt className="text-caption text-label-secondary">{part.label}</dt>
            <dd className="text-body">
              <Money amount={part.amount} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-separator/60 pt-3 text-body text-pretty">
        {locked ? (
          <>
            Pay <Money amount={totals.remit} className="font-semibold" /> to DRC by {formatLongDate(dueDate).replace(/ \d{4}$/, "")}
          </>
        ) : (
          <>
            <Money amount={totals.remit} className="font-semibold" /> goes to DRC by {formatLongDate(dueDate).replace(/ \d{4}$/, "")}
          </>
        )}
        <span className="text-label-secondary"> (TDS and HC)</span>
      </p>
    </section>
  );
}
