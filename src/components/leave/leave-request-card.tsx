"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { controlClass } from "@/components/field";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatDays, formatSpan } from "@/lib/format";
import { decideLeave } from "@/modules/leave/actions";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import type { PendingLeaveView } from "@/modules/leave/repository";

/** A leave request waiting for the admin: who, what, how many days, what's left. Approve is the one primary action. */
export function LeaveRequestCard({ request }: { request: PendingLeaveView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"approved" | "declined" | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  function decide(decision: "approved" | "declined") {
    setChoice(decision);
    startTransition(async () => {
      const result = await decideLeave(request.id, decision, note);
      if (result.status === "done") {
        setError(null);
        // Fade out before the list refreshes, so the card doesn't vanish in a single frame.
        setLeaving(true);
        confirmWithUndo(result, router);
        router.refresh();
      } else if (result.status === "error") setError(result.message);
      setChoice(null);
    });
  }

  return (
    <article
      aria-busy={pending || undefined}
      className={`flex flex-col gap-3 border-b border-separator/60 p-4 transition-opacity duration-200 ease-(--ease-out) last:border-b-0 ${leaving ? "opacity-0" : ""}`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <Link href={`/admin/people/${request.personId}`} className="truncate text-body font-semibold">
          {request.personName}
        </Link>
        <span className="shrink-0 text-secondary text-label-secondary">{LEAVE_TYPE_NAME[request.leaveType]}</span>
      </header>
      <p className="text-body tabular">
        {formatSpan(request.startDate, request.endDate)} · <span className="font-semibold">{formatDays(request.days)}</span>
        {request.leftAfter !== null ? <span className="text-label-secondary"> · leaves {formatDays(request.leftAfter)}</span> : null}
      </p>
      {request.note ? <p className="text-secondary text-pretty text-label-secondary">“{request.note}”</p> : null}
      {noteOpen ? (
        <label className="flex flex-col gap-2">
          <span className="text-secondary font-medium">Note for {request.personName.split(" ")[0]} (optional)</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className={controlClass} autoFocus />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!noteOpen ? (
          <Button variant="plain" className="mr-auto -ml-4" onClick={() => setNoteOpen(true)}>
            Add a note
          </Button>
        ) : null}
        <Button variant="secondary" disabled={pending} aria-busy={choice === "declined" || undefined} onClick={() => decide("declined")}>
          Decline
        </Button>
        <Button disabled={pending} aria-busy={choice === "approved" || undefined} onClick={() => decide("approved")}>
          Approve
        </Button>
      </div>
    </article>
  );
}
