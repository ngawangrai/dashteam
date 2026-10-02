"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

type SheetProps = { open: boolean; onClose: () => void; title: string; children: ReactNode };

/**
 * A bottom sheet for quick tasks, built on the native <dialog>: focus is trapped and restored,
 * Escape closes it, and the page behind is inert. Tapping outside closes it too.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="sheet"
    >
      <div className="flex flex-col gap-5 px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pt-6">
        <div aria-hidden="true" className="mx-auto h-1.5 w-9 rounded-full bg-separator md:hidden" />
        <h2 id={titleId} className="text-title">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
