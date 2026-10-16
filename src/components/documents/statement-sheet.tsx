"use client";

import { Download } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { FormMessage, SelectField } from "@/components/field";
import { Icon } from "@/components/icon";
import { Money } from "@/components/money";
import { SegmentedControl } from "@/components/segmented-control";
import { Sheet } from "@/components/sheet";
import { formatMonth } from "@/lib/format";
import { statementLink } from "@/modules/documents/actions";
import { type QuickRange, periodName, quickRange } from "@/modules/documents/statement-model";
import type { PaidMonth } from "@/modules/documents/statements";

// A pay statement: pick a range, see what it covers and its take-home, download. Six months is
// chosen already, so it's one tap from here.

type Choice = "3" | "6" | "12" | "custom";

const CHOICES = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
  { value: "custom", label: "Custom" },
] as const;

const toMonth = (key: string) => ({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) });
const keyOf = ({ year, month }: { year: number; month: number }) => `${year}-${String(month).padStart(2, "0")}`;

type StatementSheetProps = { open: boolean; onClose: () => void; personId: string; months: PaidMonth[]; title?: string };

export function StatementSheet({ open, onClose, personId, months, title = "Pay statement" }: StatementSheetProps) {
  const [choice, setChoice] = useState<Choice>("6");
  const keys = months.map((m) => m.monthKey);
  const [from, setFrom] = useState(keys[Math.max(0, keys.length - 6)] ?? "");
  const [to, setTo] = useState(keys.at(-1) ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const quick = choice === "custom" ? null : quickRange(keys.map(toMonth), Number(choice) as QuickRange);
  const range = quick ? { from: keyOf(quick.from), to: keyOf(quick.to) } : from && to && from <= to ? { from, to } : null;
  const inRange = range ? months.filter((m) => m.monthKey >= range.from && m.monthKey <= range.to) : [];
  const takeHome = inRange.reduce((sum, m) => sum + m.takeHome, 0);
  const options = months.map((m) => ({ value: m.monthKey, label: formatMonth(toMonth(m.monthKey), { withYear: true }) }));

  function download() {
    if (!range) return;
    setError(null);
    start(async () => {
      const result = await statementLink(personId, range.from, range.to);
      if (result.status === "ready") window.location.assign(result.url);
      else setError(result.message);
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <SegmentedControl name="statement-range" label="Months" options={CHOICES} value={choice} onChange={setChoice} />
      {choice === "custom" ? (
        <div className="grid grid-cols-2 gap-3">
          <SelectField name="from" label="From" options={options} value={from} onChange={(event) => setFrom(event.target.value)} />
          <SelectField name="to" label="To" options={options} value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      ) : null}

      <div className="flex flex-col gap-1" aria-live="polite">
        {range && inRange.length ? (
          <>
            <span className="text-secondary text-label-secondary">
              {periodName({ from: toMonth(range.from), to: toMonth(range.to) })} · {inRange.length === 1 ? "1 payslip" : `${inRange.length} payslips`}
            </span>
            <Money amount={takeHome} className="text-large-title" />
            <span className="text-secondary text-label-secondary">Take-home for the period</span>
          </>
        ) : (
          <span className="text-secondary text-label-secondary">{range ? "There’s no pay in those months." : "Choose a From month on or before the To month."}</span>
        )}
      </div>

      <Button fullWidth disabled={pending || !range || !inRange.length} aria-busy={pending || undefined} onClick={download}>
        <Icon icon={Download} size={20} />
        {pending ? "Making your statement…" : "Download statement"}
      </Button>
      <FormMessage message={error} />
    </Sheet>
  );
}
