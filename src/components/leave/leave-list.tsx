"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { InsetRow } from "@/components/inset-section";
import { Sheet } from "@/components/sheet";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatDate, formatDays, formatSpan, thimphuToday } from "@/lib/format";
import { cancelLeave } from "@/modules/leave/actions";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import type { LeaveRequestView } from "@/modules/leave/repository";
import { StatusBadge } from "./status-badge";

/** A person's requests. Tapping one shows the details, and Cancel when it can still be cancelled. */
export function LeaveList({ requests, today, canCancelStarted = false }: { requests: LeaveRequestView[]; today: string; canCancelStarted?: boolean }) {
  const [open, setOpen] = useState<LeaveRequestView | null>(null);
  return (
    <>
      {requests.map((request) => (
        <button
          key={request.id}
          type="button"
          onClick={() => setOpen(request)}
          className="flex min-h-11 w-full items-center gap-3 border-b border-separator/60 px-4 py-2.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-fill/60 active:bg-fill"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body">
              {LEAVE_TYPE_NAME[request.leaveType]} · <span className="tabular">{formatSpan(request.startDate, request.endDate)}</span>
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-secondary text-label-secondary">
              <span className="tabular">{formatDays(request.days)}</span>
              <StatusBadge status={request.status} />
            </span>
          </span>
          <Icon icon={ChevronRight} size={18} className="shrink-0 text-label-secondary" />
        </button>
      ))}
      {open ? <RequestDetail request={open} today={today} canCancelStarted={canCancelStarted} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function RequestDetail({
  request,
  today,
  canCancelStarted,
  onClose,
}: {
  request: LeaveRequestView;
  today: string;
  canCancelStarted: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cancellable =
    request.status === "pending" || (request.status === "approved" && (canCancelStarted || request.startDate > (today || thimphuToday())));

  return (
    <Sheet open onClose={onClose} title={LEAVE_TYPE_NAME[request.leaveType]}>
      <div className="-mx-4 flex flex-col">
        <InsetRow label="Dates">
          <span className="tabular">{formatSpan(request.startDate, request.endDate)}</span>
        </InsetRow>
        <InsetRow label="Days counted">
          <span className="tabular">{formatDays(request.days)}</span>
        </InsetRow>
        <InsetRow label="Status">
          <StatusBadge status={request.status} />
        </InsetRow>
        {request.note ? <InsetRow label="Your note">{request.note}</InsetRow> : null}
        {request.decisionNote ? <InsetRow label="Admin’s note">{request.decisionNote}</InsetRow> : null}
        <InsetRow label="Sent">{formatDate(thimphuToday(new Date(request.createdAt)))}</InsetRow>
      </div>
      {error ? (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      ) : null}
      {cancellable ? (
        <Button
          variant="secondary"
          fullWidth
          disabled={pending}
          aria-busy={pending || undefined}
          className="text-danger"
          onClick={() =>
            startTransition(async () => {
              const result = await cancelLeave(request.id);
              if (result.status === "done") {
                onClose();
                confirmWithUndo(result, router);
                router.refresh();
              } else if (result.status === "error") setError(result.message);
            })
          }
        >
          {request.status === "pending" ? "Cancel request" : "Cancel this leave"}
        </Button>
      ) : null}
    </Sheet>
  );
}
