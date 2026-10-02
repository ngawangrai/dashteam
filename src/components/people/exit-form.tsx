"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FormMessage, TextField } from "@/components/field";
import { InsetSection } from "@/components/inset-section";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatDate, formatLongDate } from "@/lib/format";
import { type ActionState, markAsLeft } from "@/modules/people/actions";

type ExitFormProps = { personId: string; firstName: string; startDate: string; today: string };

export function ExitForm({ personId, firstName, startDate, today }: ExitFormProps) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await (markAsLeft.bind(null, personId))(previous, formData);
    if (result.status === "done") {
      confirmWithUndo(result, router);
      if (result.redirectTo) router.push(result.redirectTo as Parameters<typeof router.push>[0]);
    }
    return result;
  }, { status: "idle" });
  const [endDate, setEndDate] = useState(today);

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(endDate);

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <InsetSection
        footer={
          valid
            ? `${firstName} can sign in until the end of ${formatLongDate(endDate)}. Their records and payslips stay, and you can still see them under Former.`
            : undefined
        }
      >
        <div className="p-4">
          <TextField
            name="endDate"
            label="Last working day"
            type="date"
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            error={errors.endDate}
            required
          />
        </div>
      </InsetSection>
      <FormMessage message={state.status === "error" && !Object.keys(errors).length ? state.message : null} />
      <Button type="submit" disabled={pending || !valid} aria-busy={pending || undefined} className="md:self-end">
        {pending ? "Saving…" : valid ? `Mark ${firstName} as left on ${formatDate(endDate)}` : `Mark ${firstName} as left`}
      </Button>
    </form>
  );
}
