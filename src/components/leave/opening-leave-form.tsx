"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FormMessage, controlClass } from "@/components/field";
import { InsetSection } from "@/components/inset-section";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatDays } from "@/lib/format";
import { type LeaveActionState, saveOpeningLeave } from "@/modules/leave/actions";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import type { OpeningPerson } from "@/modules/leave/opening";

// Leave already taken this year before DashTeam started. One small field per person and yearly leave
// type, and what that leaves them, worked out as it's typed. Saved all at once, with Undo.

const fieldName = (personId: string, leaveType: string) => `opening:${personId}:${leaveType}`;
const parse = (text: string) => {
  const days = Number(text.trim() === "" ? 0 : text);
  return Number.isFinite(days) && days >= 0 && Number.isInteger(days * 2) ? days : null;
};

type Props = { year: number; asOf: string; locked: boolean; people: OpeningPerson[] };

export function OpeningLeaveForm({ year, asOf, locked, people }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(people.flatMap((person) => person.lines.map((line) => [fieldName(person.personId, line.leaveType), line.opening ? String(line.opening) : ""]))),
  );
  const [state, action, saving] = useActionState<LeaveActionState, FormData>(async (previous, formData) => {
    const result = await saveOpeningLeave(previous, formData);
    if (result.status === "done") {
      confirmWithUndo(result, router);
      router.refresh();
    }
    return result;
  }, { status: "idle" });
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="asOf" value={asOf} />
      {people.map((person) => (
        <InsetSection key={person.personId} title={person.name}>
          {person.lines.map((line) => {
            const name = fieldName(person.personId, line.leaveType);
            const typed = parse(values[name] ?? "");
            const left = typed === null ? null : line.entitlement - line.inDashTeam - line.pending - typed;
            const error = errors?.[name];
            return (
              <div key={line.leaveType} className="flex min-h-11 items-center gap-3 border-b border-separator/60 px-4 py-2 last:border-b-0">
                <label htmlFor={name} className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body">{LEAVE_TYPE_NAME[line.leaveType]}</span>
                  <span aria-live="polite" className={`text-secondary ${left !== null && left < 0 ? "text-warning" : "text-label-secondary"}`}>
                    {error
                      ? error
                      : left === null
                        ? "Use whole or half days"
                        : `Leaves ${formatDays(Math.max(left, 0))} of ${formatDays(line.entitlement)}${left < 0 ? `, ${formatDays(-left)} over` : ""}${line.inDashTeam ? ` · ${formatDays(line.inDashTeam)} already in DashTeam` : ""}`}
                  </span>
                </label>
                <input
                  id={name}
                  name={name}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  disabled={locked}
                  value={values[name] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
                  aria-invalid={error || typed === null ? true : undefined}
                  aria-label={`${LEAVE_TYPE_NAME[line.leaveType]} taken before DashTeam, in days`}
                  className={`${controlClass} tabular w-20 text-right`}
                />
              </div>
            );
          })}
        </InsetSection>
      ))}
      {locked ? null : (
        <Button type="submit" fullWidth disabled={saving} aria-busy={saving || undefined}>
          {saving ? "Saving…" : "Save leave taken"}
        </Button>
      )}
      <FormMessage message={state.status === "error" && !errors ? state.message : null} />
    </form>
  );
}
