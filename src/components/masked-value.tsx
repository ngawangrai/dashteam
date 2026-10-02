"use client";

import { useState, useTransition } from "react";
import { maskedLast4 } from "@/lib/format";
import { revealField } from "@/modules/people/actions";
import type { EncryptedField } from "@/lib/crypto/field";

type MaskedValueProps = { personId: string; field: EncryptedField; last4: string | null; label: string };

/**
 * A TPN or account number, masked until asked for. Showing it is checked on the server
 * (owner or admin only) and recorded in the audit log. It hides again when you leave the page.
 */
export function MaskedValue({ personId, field, last4, label }: MaskedValueProps) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!last4) return <span className="text-label-secondary">Not added</span>;

  function toggle() {
    if (value) {
      setValue(null);
      return;
    }
    startTransition(async () => {
      const result = await revealField(personId, field);
      if (result.ok) {
        setValue(result.value);
        setError(null);
      } else setError(result.message);
    });
  }

  return (
    <span className="flex items-center gap-3">
      <span className="flex flex-col items-end">
        <span key={value ? "shown" : "hidden"} className="reveal tabular">
          {value ?? maskedLast4(last4)}
        </span>
        {error ? (
          <span role="alert" className="text-caption text-danger">
            {error}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={toggle}
        aria-busy={pending || undefined}
        aria-label={`${value ? "Hide" : "Show"} ${label}`}
        className="pressable -my-2 min-h-11 min-w-11 px-1 text-accent aria-busy:opacity-60"
      >
        {value ? "Hide" : "Show"}
      </button>
    </span>
  );
}
