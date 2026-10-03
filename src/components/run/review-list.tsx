"use client";

import { ChevronRight, CircleAlert } from "lucide-react";
import { Icon } from "@/components/icon";
import { Money } from "@/components/money";
import type { RunException } from "@/modules/run/exceptions";
import type { Chhertum } from "@/modules/rules/types";
import { ExceptionBadges } from "./exception-badges";

export type ReviewRow = {
  personId: string;
  fullName: string;
  /** Employment type, in words. */
  detail: string;
  gross: Chhertum | null;
  deductions: Chhertum | null;
  takeHome: Chhertum | null;
  exceptions: RunException[];
  /** Why there are no figures, in a few words. */
  problem: string | null;
};

type Totals = { gross: Chhertum; takeHome: Chhertum };

function Problem({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-secondary text-danger">
      <Icon icon={CircleAlert} size={16} />
      {text}
    </span>
  );
}

/**
 * Everyone in the month. On a laptop, one table to scan down; on a phone, one row per person with
 * take-home on the right. Tapping anyone opens their breakdown.
 */
export function ReviewList({ rows, totals, onOpen, label }: { rows: ReviewRow[]; totals: Totals; onOpen: (personId: string) => void; label: string }) {
  return (
    <>
      {/* Laptop */}
      <div className="hidden overflow-hidden rounded-card bg-surface md:block">
        <table className="w-full text-body">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-separator/60 text-left text-caption text-label-secondary">
              <th scope="col" className="px-4 py-2.5 font-normal">
                Name
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-normal">
                Gross
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-normal">
                Deductions
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-normal">
                Take-home
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.personId}
                onClick={() => onOpen(row.personId)}
                className="cursor-pointer border-b border-separator/60 align-top transition-colors duration-150 hover:bg-fill/60 active:bg-fill"
              >
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(row.personId);
                      }}
                      className="w-fit text-left"
                    >
                      <span className="block font-medium">{row.fullName}</span>
                      <span className="block text-secondary text-label-secondary">{row.detail}</span>
                    </button>
                    <ExceptionBadges exceptions={row.exceptions} />
                  </div>
                </th>
                {row.problem ? (
                  <td colSpan={3} className="px-4 py-3 text-right">
                    <Problem text={row.problem} />
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-3 text-right">
                      <Money amount={row.gross ?? 0} className="text-label-secondary" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money amount={row.deductions ?? 0} className="text-label-secondary" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money amount={row.takeHome ?? 0} className="font-semibold" />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-body font-semibold">
              <th scope="row" className="px-4 py-3 text-left">
                Total
              </th>
              <td className="px-4 py-3 text-right">
                <Money amount={totals.gross} />
              </td>
              <td className="px-4 py-3 text-right">
                <Money amount={totals.gross - totals.takeHome} />
              </td>
              <td className="px-4 py-3 text-right">
                <Money amount={totals.takeHome} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone */}
      <ul aria-label={label} className="rounded-card bg-surface md:hidden">
        {rows.map((row) => (
          <li key={row.personId} className="border-b border-separator/60 last:border-b-0">
            <button type="button" onClick={() => onOpen(row.personId)} className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left active:bg-fill">
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex flex-col">
                  <span className="truncate text-body font-medium">{row.fullName}</span>
                  <span className="text-secondary text-label-secondary">{row.detail}</span>
                </span>
                <ExceptionBadges exceptions={row.exceptions} />
              </span>
              <span className="shrink-0 text-right">{row.problem ? <Problem text={row.problem} /> : <Money amount={row.takeHome ?? 0} className="text-body font-semibold" />}</span>
              <Icon icon={ChevronRight} size={18} className="shrink-0 text-label-secondary" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
