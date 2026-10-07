"use client";

import { useEffect, useState } from "react";

/**
 * A value to type into RAMIS: shown as people read it, copied as RAMIS wants it (no commas).
 * The label says "Copied" for a moment so the tap clearly registered.
 */
export function CopyButton({ display, value, label, truncate = false }: { display: string; value: string; label: string; truncate?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard blocked: the value is on screen to select by hand.
        }
      }}
      aria-label={`Copy ${label}: ${display}`}
      className={`pressable inline-flex min-h-11 min-w-11 items-center rounded-control px-1.5 tabular hover:bg-fill/60 active:bg-fill ${truncate ? "max-w-full justify-start text-left" : "justify-end text-right"}`}
    >
      <span aria-live="polite" className={truncate ? "truncate" : "whitespace-nowrap"}>
        {copied ? <span className="text-success">Copied</span> : display}
      </span>
    </button>
  );
}

/** "21935" or "12345.50": an amount in ngultrum as a form field wants it. */
export function plainAmount(chhertum: number): string {
  const whole = Math.trunc(chhertum / 100);
  const part = Math.abs(chhertum % 100);
  return part ? `${whole}.${String(part).padStart(2, "0")}` : String(whole);
}
