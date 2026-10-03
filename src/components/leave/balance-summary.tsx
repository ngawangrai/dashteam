import { InsetRow, InsetSection } from "@/components/inset-section";
import { formatDays } from "@/lib/format";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import type { BalanceLine } from "@/modules/leave/repository";

/** Leave left this year, one line per kind. Yearly pools first; the rest say how they work. */
export function BalanceSummary({ lines, title = "Leave this year", compact = false }: { lines: BalanceLine[]; title?: string; compact?: boolean }) {
  const shown = compact ? lines.filter((line) => line.balance.kind === "pool") : lines;
  if (!shown.length) return null;
  return (
    <InsetSection title={title}>
      {shown.map(({ leaveType, balance }) => (
        <InsetRow key={leaveType} label={LEAVE_TYPE_NAME[leaveType]}>
          {balance.kind === "pool" ? (
            <span className="tabular">
              <span className="font-semibold text-label">{formatDays(balance.left).replace(/ days?$/, "")}</span> of {balance.entitlement} left
              {balance.pending ? ` · ${formatDays(balance.pending)} waiting` : ""}
            </span>
          ) : balance.kind === "perEvent" ? (
            <span className="tabular">{formatDays(balance.allowance)} each time</span>
          ) : balance.kind === "noLimit" ? (
            <span className="tabular">{balance.used ? `${formatDays(balance.used)} taken` : "Ask when you need it"}</span>
          ) : null}
        </InsetRow>
      ))}
    </InsetSection>
  );
}
