"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FormMessage, SelectField } from "@/components/field";
import { InsetSection } from "@/components/inset-section";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatMonth, monthOf } from "@/lib/format";
import { type ActionState, changePay } from "@/modules/people/actions";
import type { RulesByType } from "@/modules/people/estimate";
import type { Chhertum } from "@/modules/rules/types";
import { PayFields, type PayValues } from "./pay-fields";

type ChangePayFormProps = {
  personId: string;
  months: { value: string; label: string }[];
  defaultMonth: string;
  initial: PayValues;
  rules: RulesByType | null;
  now: Chhertum | null;
};

export function ChangePayForm({ personId, months, defaultMonth, initial, rules, now }: ChangePayFormProps) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await (changePay.bind(null, personId))(previous, formData);
    if (result.status === "done") {
      confirmWithUndo(result, router);
      if (result.redirectTo) router.push(result.redirectTo as Parameters<typeof router.push>[0]);
    }
    return result;
  }, { status: "idle" });
  const [effectiveFrom, setEffectiveFrom] = useState(defaultMonth);
  const [pay, setPay] = useState(initial);

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const monthName = formatMonth(monthOf(effectiveFrom));

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <InsetSection title="New pay">
        <div className="flex flex-col gap-4 p-4">
          <SelectField
            name="effectiveFrom"
            label="From"
            options={months}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            error={errors.effectiveFrom}
          />
          <PayFields values={pay} onChange={setPay} errors={errors} rules={rules} now={now} estimateLabel={`From ${monthName}, take-home`} />
        </div>
      </InsetSection>
      <FormMessage message={state.status === "error" && !Object.keys(errors).length ? state.message : null} />
      <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="md:self-end">
        {pending ? "Saving…" : `Change pay from ${monthName}`}
      </Button>
    </form>
  );
}
