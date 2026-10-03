"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FormMessage, SelectField } from "@/components/field";
import { confirmWithUndo } from "@/components/undo-toast";
import { type RunActionState, setFirstMonth } from "@/modules/run/actions";

type Choice = { value: string; label: string };

/** Asked once: the first month DashTeam pays. Earlier months were paid outside it. */
export function FirstMonthForm({ choices, defaultValue }: { choices: Choice[]; defaultValue: string }) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultValue);
  const [state, formAction, pending] = useActionState<RunActionState, FormData>(async (previous, formData) => {
    const result = await setFirstMonth(previous, formData);
    if (result.status === "done") {
      confirmWithUndo(result, router, { afterUndo: "/admin/payroll" });
      if (result.redirectTo) router.push(result.redirectTo as Route);
    }
    return result;
  }, { status: "idle" });
  const label = choices.find((choice) => choice.value === month)?.label ?? "";

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-card bg-surface p-4" noValidate>
      <div className="flex flex-col gap-1">
        <h2 className="text-title">Which month does DashTeam pay first?</h2>
        <p className="text-secondary text-pretty text-label-secondary">
          Months before it were paid another way and stay out of DashTeam. You can change this until you lock your first month.
        </p>
      </div>
      <SelectField
        name="month"
        label="First payroll month"
        options={choices}
        value={month}
        onChange={(event) => setMonth(event.target.value)}
        error={state.status === "error" ? state.fieldErrors?.month : undefined}
      />
      <FormMessage message={state.status === "error" && !state.fieldErrors ? state.message : null} />
      <Button type="submit" fullWidth disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Starting…" : `Start with ${label}`}
      </Button>
    </form>
  );
}
