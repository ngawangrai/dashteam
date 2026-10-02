import { formatNu } from "@/lib/format";
import type { Chhertum } from "@/modules/rules/types";

/** Money is never truncated and always lines up: tabular figures, no wrapping. */
export function Money({ amount, className = "" }: { amount: Chhertum; className?: string }) {
  return <span className={`tabular whitespace-nowrap ${className}`}>{formatNu(amount)}</span>;
}
