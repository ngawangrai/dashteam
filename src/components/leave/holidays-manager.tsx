"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import type { Holiday } from "@/modules/leave/holidays";
import { CopyForward, HolidaySheet } from "./holiday-sheet";
import { HolidayList } from "./holiday-list";

type Item = Holiday & { id: string };

/** The admin's holidays for a year: add, tap one to edit, move, confirm or remove it; copy fixed dates on. */
export function HolidaysManager({ year, holidays }: { year: number; holidays: Item[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="md:w-56">
          <Button fullWidth onClick={() => setAdding(true)}>
            Add holiday
          </Button>
        </div>
        {holidays.some((holiday) => holiday.kind === "fixed") ? <CopyForward fromYear={year} /> : null}
      </div>

      {holidays.length ? (
        <HolidayList
          holidays={holidays}
          row={(holiday, content) => (
            <button
              key={holiday.id}
              type="button"
              onClick={() => setEditing(holiday)}
              className="flex min-h-11 w-full items-center gap-3 border-b border-separator/60 px-4 py-2.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-fill/60 active:bg-fill"
            >
              {content}
              <Icon icon={ChevronRight} size={18} className="shrink-0 text-label-secondary" />
            </button>
          )}
        />
      ) : (
        <p className="rounded-card bg-surface px-4 py-3 text-body text-label-secondary">
          No holidays for {year} yet. Add them, or copy the fixed dates from {year - 1}, and leave on those days won’t be counted.
        </p>
      )}

      {adding ? <HolidaySheet open onClose={() => setAdding(false)} year={year} /> : null}
      {editing ? <HolidaySheet key={editing.id} open onClose={() => setEditing(null)} year={year} holiday={editing} /> : null}
    </>
  );
}
