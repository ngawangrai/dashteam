import type { ReactNode } from "react";
import { InsetSection } from "@/components/inset-section";
import { formatMonth, formatSpan } from "@/lib/format";
import type { Holiday } from "@/modules/leave/holidays";
import { HolidayBadges } from "./holiday-badges";

type Item = Holiday & { id: string };

/** A year's holidays grouped by month. `row` lets the admin screen make each one tappable. */
export function HolidayList({ holidays, row }: { holidays: Item[]; row?: (holiday: Item, content: ReactNode) => ReactNode }) {
  const months = new Map<number, Item[]>();
  for (const holiday of holidays) {
    const month = Number(holiday.startDate.slice(5, 7));
    months.set(month, [...(months.get(month) ?? []), holiday]);
  }
  return (
    <>
      {[...months.entries()].map(([month, list]) => (
        <InsetSection key={month} title={formatMonth({ year: list[0]?.year ?? 0, month })}>
          {list.map((holiday) => {
            const content = (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-pretty">{holiday.name}</span>
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="text-secondary text-label tabular">{formatSpan(holiday.startDate, holiday.endDate)}</span>
                  <HolidayBadges holiday={holiday} />
                </span>
              </span>
            );
            return row ? (
              row(holiday, content)
            ) : (
              <div key={holiday.id} className="flex min-h-11 items-center border-b border-separator/60 px-4 py-2.5 last:border-b-0">
                {content}
              </div>
            );
          })}
        </InsetSection>
      ))}
    </>
  );
}
