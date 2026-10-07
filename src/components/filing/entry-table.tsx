"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { formatNu } from "@/lib/format";
import { setEntered } from "@/modules/filing/actions";
import type { ScheduleRow, ScheduleTotals } from "@/modules/filing/schedule";
import { CopyButton, plainAmount } from "./copy-button";

// Typing the IT-1(a) into RAMIS by hand: every field one tap to copy, in the form's own order, and a
// tick per person so it's clear who's done. Ticks are saved, so a reload or another device keeps them.

// The form's names for each field, and a short header for the laptop table where all 13 sit side by side.
const AMOUNTS = [
  { key: "basic", label: "Basic Salary", short: "Basic" },
  { key: "allowance", label: "Benefit / Allowance", short: "Allowance" },
  { key: "arrear", label: "Salary Arrear", short: "Arrear" },
  { key: "gross", label: "Gross Salary", short: "Gross" },
  { key: "pf", label: "PF", short: "PF" },
  { key: "gis", label: "GIS", short: "GIS" },
  { key: "net", label: "Net Salary", short: "Net" },
  { key: "tds", label: "TDS", short: "TDS" },
  { key: "hc", label: "Health Contribution", short: "HC" },
  { key: "total", label: "Total (TDS + HC)", short: "Total" },
] as const;

const amountText = (chhertum: number) => formatNu(chhertum).replace("Nu. ", "");

function Tick({ checked, name, onChange }: { checked: boolean; name: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-5 accent-(--color-accent)" />
      <span className="sr-only">{name} entered</span>
    </label>
  );
}

export function EntryTable({ monthKey, rows, totals, entered }: { monthKey: string; rows: ScheduleRow[]; totals: ScheduleTotals; entered: string[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [ticked, setTicked] = useOptimistic(new Set(entered), (current, change: { personId: string; on: boolean }) => {
    const next = new Set(current);
    if (change.on) next.add(change.personId);
    else next.delete(change.personId);
    return next;
  });

  function tick(personId: string, on: boolean) {
    startTransition(async () => {
      setTicked({ personId, on });
      const result = await setEntered(monthKey, personId, on);
      if (result.status === "error") toast(result.message);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="px-4 text-body tabular" aria-live="polite">
        {ticked.size} of {rows.length} entered
      </p>

      {/* Laptop: the form's columns, left to right. */}
      <div className="hidden overflow-x-auto rounded-card bg-surface lg:block">
        <table className="w-full text-secondary">
          <caption className="sr-only">IT-1(a) to enter by hand</caption>
          <thead>
            <tr className="border-b border-separator/60 text-left text-caption text-label-secondary">
              <th scope="col" className="w-11 px-1 py-2 font-normal">
                <span className="sr-only">Entered</span>
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                Name
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                TPN
              </th>
              {AMOUNTS.map((column) => (
                <th key={column.key} scope="col" className="px-1 py-2 text-right font-normal">
                  <abbr title={column.label} className="no-underline">
                    {column.short}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.personId} className={`border-b border-separator/60 ${ticked.has(row.personId) ? "text-label-secondary" : ""}`}>
                <td className="px-1">
                  <Tick checked={ticked.has(row.personId)} name={row.name} onChange={(on) => tick(row.personId, on)} />
                </td>
                <th scope="row" className="max-w-48 text-left font-normal" title={row.name}>
                  <CopyButton display={row.name} value={row.name} label={`${row.name}’s name`} truncate />
                </th>
                <td className="whitespace-nowrap">{row.tpn ? <CopyButton display={row.tpn} value={row.tpn} label={`${row.name}’s TPN`} /> : <span className="px-2 text-danger">No TPN</span>}</td>
                {AMOUNTS.map((column) => (
                  <td key={column.key} className="text-right">
                    <CopyButton display={amountText(row[column.key])} value={plainAmount(row[column.key])} label={`${row.name}’s ${column.label}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td />
              <th scope="row" className="px-2 py-3 text-left">
                Total
              </th>
              <td />
              {AMOUNTS.map((column) => (
                <td key={column.key} className="px-2 py-3 text-right tabular">
                  {amountText(totals[column.key])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone and narrow screens: one card per person, fields in the same order. */}
      <ul className="flex flex-col gap-3 lg:hidden" aria-label="IT-1(a) to enter by hand">
        {rows.map((row) => (
          <li key={row.personId} className={`rounded-card bg-surface ${ticked.has(row.personId) ? "opacity-70" : ""}`}>
            <div className="flex items-center gap-2 border-b border-separator/60 pr-2 pl-1">
              <Tick checked={ticked.has(row.personId)} name={row.name} onChange={(on) => tick(row.personId, on)} />
              <span className="min-w-0 flex-1 truncate text-body font-semibold">{row.name}</span>
            </div>
            <dl className="px-4 py-1">
              {[
                { label: "Name", display: row.name, value: row.name },
                { label: "TPN", display: row.tpn || "No TPN on file", value: row.tpn },
                ...AMOUNTS.map((column) => ({ label: column.label, display: amountText(row[column.key]), value: plainAmount(row[column.key]) })),
              ].map((field) => (
                <div key={field.label} className="flex items-center justify-between gap-3 border-b border-separator/60 last:border-b-0">
                  <dt className="text-secondary text-label-secondary">{field.label}</dt>
                  <dd>{field.value ? <CopyButton display={field.display} value={field.value} label={`${row.name}’s ${field.label}`} /> : <span className="text-secondary text-danger">{field.display}</span>}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        <li className="rounded-card bg-surface px-4 py-3">
          <p className="text-body font-semibold">Totals to check against RAMIS</p>
          <dl className="mt-1">
            {AMOUNTS.map((column) => (
              <div key={column.key} className="flex justify-between gap-3 py-1 text-secondary">
                <dt className="text-label-secondary">{column.label}</dt>
                <dd className="tabular">{amountText(totals[column.key])}</dd>
              </div>
            ))}
          </dl>
        </li>
      </ul>
    </div>
  );
}
