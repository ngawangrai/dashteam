import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";

export function YearSwitcher({ year, path }: { year: number; path: string }) {
  return (
    <div className="flex items-center gap-1">
      <Link href={`${path}?year=${year - 1}` as Route} aria-label={`${year - 1}`} className="flex size-11 items-center justify-center text-accent">
        <Icon icon={ChevronLeft} size={22} />
      </Link>
      <span className="text-title tabular" aria-live="polite">
        {year}
      </span>
      <Link href={`${path}?year=${year + 1}` as Route} aria-label={`${year + 1}`} className="flex size-11 items-center justify-center text-accent">
        <Icon icon={ChevronRight} size={22} />
      </Link>
    </div>
  );
}
