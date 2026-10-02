"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { FormMessage, SelectField, TextField } from "@/components/field";
import { Sheet } from "@/components/sheet";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatPhone, maskedLast4 } from "@/lib/format";
import { type ActionState, requestChange, withdrawRequest } from "@/modules/people/actions";
import { BANKS } from "@/modules/people/banks";

type Current = { phone: string | null; bankName: string | null; bankAccountLast4: string | null };

/** Profile's one primary action: ask the admin to change contact or bank details, in a bottom sheet. */
export function RequestChange({ current }: { current: Current }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await requestChange(previous, formData);
    if (result.status === "done") {
      setOpen(false);
      confirmWithUndo(result, router);
      router.refresh();
    }
    return result;
  }, { status: "idle" });
  const [values, setValues] = useState({ phone: current.phone ? formatPhone(current.phone) : "", bankName: current.bankName ?? "", bankAccount: "" });

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const bankChanged = values.bankName !== (current.bankName ?? "");

  return (
    <>
      <Button fullWidth onClick={() => setOpen(true)}>
        Request a change
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Request a change">
        <form action={action} className="flex flex-col gap-4" noValidate>
          <p className="text-secondary text-pretty text-label-secondary">Your admin checks the change before it’s saved.</p>
          <TextField
            name="phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={values.phone}
            onChange={(e) => setValues({ ...values, phone: e.target.value })}
            error={errors.phone}
          />
          <SelectField
            name="bankName"
            label="Bank"
            options={BANKS.map((bank) => ({ value: bank, label: bank }))}
            placeholder="Choose a bank"
            value={values.bankName}
            onChange={(e) => setValues({ ...values, bankName: e.target.value })}
            error={errors.bankName}
          />
          <TextField
            name="bankAccount"
            label="Account number"
            inputMode="numeric"
            autoComplete="off"
            className="tabular"
            value={values.bankAccount}
            onChange={(e) => setValues({ ...values, bankAccount: e.target.value })}
            error={errors.bankAccount}
            hint={
              bankChanged
                ? "Enter the account number at your new bank."
                : current.bankAccountLast4
                  ? `Leave empty to keep ${maskedLast4(current.bankAccountLast4)}.`
                  : undefined
            }
          />
          <FormMessage message={state.status === "error" && !Object.keys(errors).length ? state.message : null} />
          <Button type="submit" fullWidth disabled={pending} aria-busy={pending || undefined}>
            {pending ? "Sending…" : "Send for approval"}
          </Button>
        </form>
      </Sheet>
    </>
  );
}

export function WithdrawRequest({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end">
      <Button
        variant="plain"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(async () => {
            const result = await withdrawRequest(requestId);
            if (result.status === "done") {
              confirmWithUndo(result, router);
              router.refresh();
            } else if (result.status === "error") setError(result.message);
          })
        }
      >
        Withdraw
      </Button>
      {error ? (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
