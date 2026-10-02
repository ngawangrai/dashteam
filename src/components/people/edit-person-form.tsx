"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/field";
import { confirmWithUndo } from "@/components/undo-toast";
import { type ActionState, updatePerson } from "@/modules/people/actions";
import { DetailsFields, type DetailsValues } from "./details-fields";

type EditPersonFormProps = {
  personId: string;
  initial: DetailsValues;
  stored: { bankAccountLast4: string | null; tpnLast4: string | null };
};

export function EditPersonForm({ personId, initial, stored }: EditPersonFormProps) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await (updatePerson.bind(null, personId))(previous, formData);
    if (result.status === "done") {
      confirmWithUndo(result, router);
      if (result.redirectTo) router.push(result.redirectTo as Parameters<typeof router.push>[0]);
    }
    return result;
  }, { status: "idle" });
  const [values, setValues] = useState(initial);

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <DetailsFields values={values} onChange={setValues} errors={errors} stored={stored} />
      <FormMessage message={state.status === "error" && !Object.keys(errors).length ? state.message : null} />
      <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="md:self-end">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
