"use client";

import type { Route } from "next";
import { toast } from "sonner";
import { undoChange } from "@/modules/audit/undo";

type Router = { refresh: () => void; push: (href: Route) => void };

/**
 * Every change can be undone (CLAUDE.md): confirm it with a short toast that offers Undo.
 * The database allows undo for 10 minutes; the toast stays long enough to read and act.
 */
export function confirmWithUndo(
  done: { message: string; transactionId: number },
  router: Router,
  options: { afterUndo?: Route } = {},
) {
  toast(done.message, {
    duration: 8000,
    action: {
      label: "Undo",
      onClick: async () => {
        const result = await undoChange(done.transactionId);
        if (!result.ok) {
          toast(result.message);
          return;
        }
        toast("Undone.");
        if (options.afterUndo) router.push(options.afterUndo);
        else router.refresh();
      },
    },
  });
}
