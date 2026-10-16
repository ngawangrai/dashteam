"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FieldShell, FormMessage, TextField, controlClass } from "@/components/field";
import { InsetSection } from "@/components/inset-section";
import { confirmWithUndo } from "@/components/undo-toast";
import { type CertificateActionState, saveSignatory } from "@/modules/documents/certificate-actions";
import type { SignatoryView } from "@/modules/documents/signatory";

/** Who signs salary certificates: their name, title and signature. One action: save. */
export function SignatoryForm({ current }: { current: SignatoryView }) {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(current?.signature?.dataUrl ?? null);
  const [state, action, saving] = useActionState<CertificateActionState, FormData>(async (previous, formData) => {
    const result = await saveSignatory(previous, formData);
    if (result.status === "done") {
      confirmWithUndo(result, router);
      router.refresh();
    }
    return result;
  }, { status: "idle" });
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <InsetSection footer="Certificates already issued keep the name and signature they were issued with.">
        <div className="flex flex-col gap-4 p-4">
          <TextField name="signatoryName" label="Name" autoComplete="off" defaultValue={current?.name ?? ""} placeholder="For example, Tashi Dorji" error={errors?.signatoryName} required />
          <TextField name="signatoryTitle" label="Title" autoComplete="off" defaultValue={current?.title ?? ""} placeholder="For example, Founder" error={errors?.signatoryTitle} required />
          <FieldShell id="signature" label="Signature (optional)" hint="A PNG or JPEG on a white or clear background, 500 KB at most. Without one, sign the printed letter by hand." error={errors?.signature}>
            <input
              id="signature"
              name="signature"
              type="file"
              accept="image/png,image/jpeg"
              className={`${controlClass} py-2`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                setPreview(file ? URL.createObjectURL(file) : (current?.signature?.dataUrl ?? null));
              }}
            />
          </FieldShell>
          {current?.signature ? <input type="hidden" name="keepSignature" value={current.signature.id} /> : null}
          {preview ? (
            <div className="flex flex-col gap-1">
              <span className="text-secondary text-label-secondary">As it prints</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of a file being chosen, never optimised. */}
              <img src={preview} alt="The signature as it will print" className="h-16 w-fit max-w-full rounded-control bg-white object-contain p-2" />
            </div>
          ) : null}
        </div>
      </InsetSection>
      <Button type="submit" fullWidth disabled={saving} aria-busy={saving || undefined}>
        {saving ? "Saving…" : "Save signatory"}
      </Button>
      <FormMessage message={state.status === "error" && !errors ? state.message : null} />
    </form>
  );
}
