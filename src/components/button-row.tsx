import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./icon";

/** A row in an inset section that opens a sheet. Looks and feels like a LinkRow. */
export function ButtonRow({ title, detail, trailing, onClick }: { title: string; detail?: ReactNode; trailing?: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-3 border-b border-separator/60 px-4 py-2.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-fill/60 active:bg-fill"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body">{title}</span>
        {detail ? <span className="truncate text-secondary text-label-secondary">{detail}</span> : null}
      </span>
      {trailing ? <span className="text-body text-label-secondary">{trailing}</span> : null}
      <Icon icon={ChevronRight} size={18} className="shrink-0 text-label-secondary" />
    </button>
  );
}
