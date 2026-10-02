"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/field";
import { InsetSection } from "@/components/inset-section";
import { confirmWithUndo } from "@/components/undo-toast";
import { type ActionState, addPerson } from "@/modules/people/actions";
import type { RulesByType } from "@/modules/people/estimate";
import { DetailsFields, type DetailsValues } from "./details-fields";
import { PayFields, type PayValues } from "./pay-fields";

export function AddPersonForm({ rules, today }: { rules: RulesByType | null; today: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await (addPerson)(previous, formData);
    if (result.status === "done") {
      confirmWithUndo(result, router, { afterUndo: "/admin/people" });
      if (result.redirectTo) router.push(result.redirectTo as Parameters<typeof router.push>[0]);
    }
    return result;
  }, { status: "idle" });
  const [details, setDetails] = useState<DetailsValues>({
    fullName: "",
    email: "",
    phone: "",
    startDate: today,
    bankName: "",
    bankAccount: "",
    tpn: "",
  });
  const [pay, setPay] = useState<PayValues>({ employmentType: "full_time", basic: "", allowances: "", stipend: "" });

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const name = details.fullName.trim();

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <DetailsFields values={details} onChange={setDetails} errors={errors} />
      <InsetSection title="Pay" footer="Starts from the 1st of the month they join. Joining mid-month is paid for the days they work.">
        <div className="p-4">
          <PayFields values={pay} onChange={setPay} errors={errors} rules={rules} />
        </div>
      </InsetSection>
      <FormMessage message={state.status === "error" && !Object.keys(errors).length ? state.message : null} />
      <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="md:self-end">
        {pending ? "Adding…" : name ? `Add ${name}` : "Add person"}
      </Button>
    </form>
  );
}
