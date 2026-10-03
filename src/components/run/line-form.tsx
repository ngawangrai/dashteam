"use client";

import { ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FieldShell, FormMessage, MoneyField, TextField, controlClass } from "@/components/field";
import { Icon } from "@/components/icon";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatNu, parseNu } from "@/lib/format";
import { calculatePay } from "@/modules/payroll";
import { type RunActionState, addLine } from "@/modules/run/actions";
import type { PersonRun } from "@/modules/run/build";
import { LINE_GROUP, LINE_KIND_NAME, type LineGroup, type LineKind, withLines } from "@/modules/run/lines";

const GROUPS: { label: string; kinds: LineKind[] }[] = [
  { label: "Added to pay", kinds: ["arrear", "bonus", "other_earning"] },
  { label: "Taken off before tax", kinds: ["leave_recovery"] },
  { label: "Taken off after tax", kinds: ["advance_recovery", "other_deduction"] },
];

const HINT: Record<LineGroup, string> = {
  earning: "Added to gross pay and taxed this month.",
  before_tax: "Taken off gross pay, so HC and TDS go down too.",
  after_tax: "Taken off take-home. TDS and HC stay the same.",
};

/** A one-off line on this month's pay, with the new take-home shown as you type. Closes the sheet when added. */
export function LineForm({ monthKey, person, onDone }: { monthKey: string; person: PersonRun; onDone: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<LineKind>("arrear");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [state, formAction, pending] = useActionState<RunActionState, FormData>(async (previous, formData) => {
    const result = await addLine(monthKey, person.personId, previous, formData);
    if (result.status === "done") {
      setAmount("");
      setNote("");
      // Close first: the sheet is modal, and Undo in the toast must be reachable.
      onDone();
      confirmWithUndo(result, router);
      router.refresh();
    }
    return result;
  }, { status: "idle" });

  const value = parseNu(amount);
  let takeHome: number | null = null;
  let tooMuch = false;
  if (value && value > 0 && person.input && person.rules) {
    try {
      takeHome = calculatePay(withLines(person.input, [...person.lines, { kind, amount: value, note }]), person.rules).takeHome;
      tooMuch = takeHome < 0;
    } catch {
      tooMuch = true;
    }
  }
  const name = LINE_KIND_NAME[kind].toLowerCase();
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FieldShell id="line-kind" label="Type" hint={HINT[LINE_GROUP[kind]]} error={errors.kind}>
        <div className="relative">
          <select
            id="line-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as LineKind)}
            aria-describedby={errors.kind ? "line-kind-error" : "line-kind-hint"}
            className={`${controlClass} appearance-none pr-10`}
          >
            {GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.kinds.map((option) => (
                  <option key={option} value={option}>
                    {LINE_KIND_NAME[option]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Icon icon={ChevronsUpDown} size={18} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-label-secondary" />
        </div>
      </FieldShell>
      <MoneyField id="line-amount" name="amount" label="Amount (Nu.)" value={amount} onChange={(event) => setAmount(event.target.value)} error={errors.amount} required />
      <TextField
        id="line-note"
        name="note"
        label="Note (optional)"
        placeholder={kind === "advance_recovery" ? "Advance, 1 of 3" : kind === "arrear" ? "September increment" : ""}
        autoComplete="off"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        error={errors.note}
      />
      <p className="text-body tabular" aria-live="polite">
        {tooMuch ? (
          <span className="text-danger">That’s more than {person.firstName}’s take-home this month. Recover the rest next month.</span>
        ) : takeHome !== null ? (
          <>
            Take-home <span className="font-semibold">{formatNu(takeHome)}</span>
            {person.result ? <span className="text-label-secondary"> (now {formatNu(person.result.takeHome)})</span> : null}
          </>
        ) : null}
      </p>
      <FormMessage message={state.status === "error" && !Object.keys(errors).length ? state.message : null} />
      <Button type="submit" variant="secondary" fullWidth disabled={pending || tooMuch} aria-busy={pending || undefined}>
        {pending ? "Adding…" : value ? `Add ${name} of ${formatNu(value)}` : "Add one-off"}
      </Button>
    </form>
  );
}
