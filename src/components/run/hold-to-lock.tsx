"use client";

import { useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/field";
import { lockPayroll } from "@/modules/run/actions";

const HOLD_MS = 1500;

/**
 * Locking is the one action that can't be undone, so it takes a deliberate press and hold. The fill
 * sweeps across at a constant speed so progress reads as time; letting go early snaps it back and
 * nothing happens. Space or Enter work the same way from the keyboard.
 */
export function HoldToLock({ monthKey, monthName }: { monthKey: string; monthName: string }) {
  const router = useRouter();
  const [holding, setHolding] = useState(false);
  const [locking, startLocking] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function lock() {
    startLocking(async () => {
      const result = await lockPayroll(monthKey);
      if (result.status === "locked") {
        toast(result.message);
        router.push(result.redirectTo as `/admin/payroll/${string}`);
        router.refresh();
      } else {
        setError(result.message);
        setHolding(false);
      }
    });
  }

  function start() {
    if (locking || holding) return;
    setError(null);
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      // A short tap of haptics, on the same moment the fill completes, where the device has it.
      navigator.vibrate?.(12);
      lock();
    }, HOLD_MS);
  }

  function cancel() {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }

  const label = locking ? `Locking ${monthName}…` : `Hold to lock ${monthName}`;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        data-holding={holding || locking || undefined}
        aria-describedby="hold-hint"
        aria-busy={locking || undefined}
        disabled={locking}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          start();
        }}
        onPointerMove={(event) => {
          // Sliding off the button (with a little give) lets go, as it does for any press.
          const box = event.currentTarget.getBoundingClientRect();
          const slack = 10;
          if (event.clientX < box.left - slack || event.clientX > box.right + slack || event.clientY < box.top - slack || event.clientY > box.bottom + slack) cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => {
          if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            event.preventDefault();
            start();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") cancel();
        }}
        onContextMenu={(event) => event.preventDefault()}
        className="hold relative isolate min-h-14 w-full touch-none overflow-hidden rounded-control bg-fill px-4 text-body font-semibold text-accent select-none"
        style={{ "--hold-ms": `${HOLD_MS}ms` } as CSSProperties}
      >
        <span>{label}</span>
        {/* The same label in the filled colours, revealed as the fill sweeps across. */}
        <span aria-hidden="true" className="hold-fill absolute inset-0 flex items-center justify-center bg-accent-fill text-on-accent">
          {label}
        </span>
      </button>
      <p id="hold-hint" className="text-center text-secondary text-label-secondary" aria-live="polite">
        {locking ? "Saving every figure as it is now." : holding ? "Keep holding…" : "Press and hold for a second and a half."}
      </p>
      <FormMessage message={error} />
    </div>
  );
}
