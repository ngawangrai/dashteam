import { formatDays, formatSpan } from "@/lib/format";
import type { ImpactChange } from "@/modules/leave/holidays";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";

/** What a holiday change does to people's leave, shown before it's saved. */
export function ImpactList({ changes }: { changes: ImpactChange[] }) {
  if (!changes.length) return <p className="text-body text-label-secondary">No one’s leave changes.</p>;
  return (
    <ul className="-mx-4 flex flex-col">
      {changes.map((change) => (
        <li key={change.requestId} className="flex items-center justify-between gap-3 border-b border-separator/60 px-4 py-2.5 last:border-b-0">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body">{change.personName}</span>
            <span className="text-secondary text-label-secondary">
              {LEAVE_TYPE_NAME[change.leaveType]} · <span className="tabular">{formatSpan(change.startDate, change.endDate)}</span>
            </span>
          </span>
          <span className="shrink-0 text-body tabular" aria-label={`${formatDays(change.before)} becomes ${formatDays(change.after)}`}>
            {formatDays(change.before).replace(/ days?$/, "")} → <span className="font-semibold">{formatDays(change.after)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
