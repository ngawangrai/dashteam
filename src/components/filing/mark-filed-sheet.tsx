"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FieldShell, FormMessage, TextField, controlClass } from "@/components/field";
import { Sheet } from "@/components/sheet";
import { confirmWithUndo } from "@/components/undo-toast";
import { toast } from "sonner";
import { type FilingActionState, markFiled } from "@/modules/filing/actions";

type MarkFiledProps = {
  monthKey: string;
  monthName: string;
  today: string;
  /** The record as it is, when editing a month already filed. */
  current?: { filedOn: string; paymentReference: string; acknowledgementNumber: string; receiptName: string | null };
};

/** Recording the filing: when, the payment reference, and the acknowledgement as a number or a receipt. */
export function MarkFiledSheet({ monthKey, monthName, today, current }: MarkFiledProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const editing = Boolean(current);
  const [state, formAction, pending] = useActionState<FilingActionState, FormData>(async (previous, formData) => {
    const result = await markFiled(monthKey, previous, formData);
    if (result.status === "done") {
      setOpen(false);
      if (result.transactionId) confirmWithUndo({ message: result.message, transactionId: result.transactionId }, router);
      else toast(result.message);
      router.refresh();
    }
    return result;
  }, { status: "idle" });
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {editing ? "Edit" : "Mark as filed"}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={editing ? `${monthName} filing` : `Mark ${monthName} as filed`}>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <TextField name="filedOn" label="Filed on" type="date" max={today} defaultValue={current?.filedOn ?? today} error={errors.filedOn} required />
          <TextField name="paymentReference" label="Payment reference" autoComplete="off" defaultValue={current?.paymentReference} error={errors.paymentReference} required />
          <TextField
            name="acknowledgementNumber"
            label="Acknowledgement number"
            autoComplete="off"
            defaultValue={current?.acknowledgementNumber}
            hint="From RAMIS once it accepts the filing. Or upload the receipt below: one is enough."
            error={errors.acknowledgementNumber}
          />
          <FieldShell id="receipt" label="Receipt (optional)" hint={current?.receiptName ? `Kept: ${current.receiptName}. Upload another to replace it.` : "PDF, PNG or JPEG, up to 5 MB."} error={errors.receipt}>
            <input id="receipt" name="receipt" type="file" accept="application/pdf,image/png,image/jpeg" className={`${controlClass} py-2.5 file:mr-3 file:rounded-control file:border-0 file:bg-surface file:px-3 file:py-1 file:text-secondary file:font-semibold file:text-accent`} />
          </FieldShell>
          <FormMessage message={state.status === "error" && !Object.keys(errors).length ? state.message : null} />
          <Button type="submit" fullWidth disabled={pending} aria-busy={pending || undefined}>
            {pending ? "Saving…" : editing ? "Save changes" : `Mark ${monthName} as filed`}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
