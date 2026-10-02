import { ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon";

/** A row in an inset section that opens another screen. */
export function LinkRow({ href, title, detail, trailing }: { href: Route; title: string; detail?: ReactNode; trailing?: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center gap-3 border-b border-separator/60 px-4 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-fill/60 active:bg-fill"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body">{title}</span>
        {detail ? <span className="truncate text-secondary text-label-secondary">{detail}</span> : null}
      </span>
      {trailing ? <span className="text-body text-label-secondary">{trailing}</span> : null}
      <Icon icon={ChevronRight} size={18} className="shrink-0 text-label-secondary" />
    </Link>
  );
}
