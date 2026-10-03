"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { SegmentedControl } from "@/components/segmented-control";
import { Sheet } from "@/components/sheet";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatDays, formatSpan } from "@/lib/format";
import type { LeaveActionState } from "@/modules/leave/actions";
import { type Employment, type LeaveRequestFacts, assessRequest } from "@/modules/leave/balance";
import type { LeaveCalendar } from "@/modules/leave/days";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import { type ChildOrder, type EmploymentType, LEAVE_TYPES, type LeavePolicy, type LeaveType, type RuleRow } from "@/modules/rules/types";
import { type DateRange, RangePicker } from "./range-picker";

export type LeaveSheetContext = {
  person: Employment;
  employmentType: EmploymentType;
  requests: LeaveRequestFacts[];
  ruleRows: RuleRow[];
  calendar: LeaveCalendar;
  /** What this person can take today, in display order. */
  policy: LeavePolicy;
  today: string;
};

type RequestSheetProps = {
  context: LeaveSheetContext;
  action: (previous: LeaveActionState, formData: FormData) => Promise<LeaveActionState>;
  /** Admin entering leave for someone: different words, no back-dating limit. */
  forName?: string;
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary" | "plain";
};

type Portion = "whole" | "morning" | "afternoon";

/** The one primary action on the leave screens: pick a kind and dates, see the balance change, send. */
export function RequestLeaveSheet({ context, action, forName, triggerLabel = "Request leave", triggerVariant = "primary" }: RequestSheetProps) {
  const router = useRouter();
  // In a fixed order: stored policies don't keep key order.
  const offered = LEAVE_TYPES.filter((type) => context.policy[type]);
  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>(offered[0] ?? "annual");
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [portion, setPortion] = useState<Portion>("whole");
  const [startHalf, setStartHalf] = useState(false);
  const [endHalf, setEndHalf] = useState(false);
  const [childOrder, setChildOrder] = useState<ChildOrder>("first_or_second");
  const [eventDate, setEventDate] = useState("");
  const [note, setNote] = useState("");

  function reset() {
    setRange({ start: null, end: null });
    setPortion("whole");
    setStartHalf(false);
    setEndHalf(false);
    setEventDate("");
    setNote("");
  }

  const [state, formAction, pending] = useActionState<LeaveActionState, FormData>(async (previous, formData) => {
    const result = await action(previous, formData);
    if (result.status === "done") {
      setOpen(false);
      reset();
      confirmWithUndo(result, router);
      router.refresh();
    }
    return result;
  }, { status: "idle" });

  const policy = context.policy[leaveType];
  const start = range.start;
  const end = range.end ?? range.start;
  const singleDay = start !== null && start === end;
  const halves = singleDay ? { startHalf: portion === "afternoon", endHalf: portion === "morning" } : { startHalf, endHalf };
  const needsChild = leaveType === "maternity" || leaveType === "paternity";

  const assessment =
    start && end && policy
      ? assessRequest(
          { leaveType, startDate: start, endDate: end, ...halves, childOrder: needsChild ? childOrder : null, eventDate: eventDate || null },
          { employmentType: context.employmentType, person: context.person, requests: context.requests, ruleRows: context.ruleRows, calendar: context.calendar },
        )
      : null;

  const name = LEAVE_TYPE_NAME[leaveType].toLowerCase();
  const submitLabel = assessment?.ok
    ? forName
      ? `Add ${formatDays(assessment.days)} of ${name} for ${forName}`
      : `Request ${formatDays(assessment.days)} of ${name}`
    : forName
      ? "Add leave"
      : "Request leave";

  function consequence() {
    if (!assessment) return start ? "Now tap the last day." : "Tap the first day of your leave.";
    if (!assessment.ok) return null;
    if (assessment.leftAfter !== null && policy?.allowance.kind === "perYear") {
      return `${forName ? "This leaves them" : "This leaves you"} ${formatDays(assessment.leftAfter)} of ${name}.`;
    }
    if (assessment.allowance !== null) return `${formatDays(assessment.days)} of the ${formatDays(assessment.allowance)} allowed.`;
    if (policy && !policy.paid) return "Unpaid: pay for these days is taken from that month’s salary.";
    return "Paid leave. Your admin confirms the days.";
  }

  const firstMonth = (context.today ?? "").slice(0, 7);

  return (
    <>
      <Button variant={triggerVariant} fullWidth={triggerVariant === "primary"} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={forName ? `Add leave for ${forName}` : "Request leave"}>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <SelectField
            name="leaveType"
            label="Kind of leave"
            options={offered.map((type) => ({ value: type, label: LEAVE_TYPE_NAME[type] }))}
            value={leaveType}
            onChange={(event) => {
              setLeaveType(event.target.value as LeaveType);
              setPortion("whole");
              setStartHalf(false);
              setEndHalf(false);
            }}
          />

          <RangePicker
            value={range}
            onChange={setRange}
            workingWeek={context.calendar.workingWeek}
            holidays={context.calendar.holidays}
            tentative={context.calendar.tentative}
            labels={context.calendar.labels}
            initialMonth={firstMonth}
            today={context.today}
          />
          <input type="hidden" name="startDate" value={start ?? ""} />
          <input type="hidden" name="endDate" value={end ?? ""} />
          <input type="hidden" name="startHalf" value={String(halves.startHalf)} />
          <input type="hidden" name="endHalf" value={String(halves.endHalf)} />

          {start && end && policy?.halfDays ? (
            singleDay ? (
              <SegmentedControl
                name="portion"
                label="Which part of the day"
                options={[
                  { value: "whole", label: "Whole day" },
                  { value: "morning", label: "Morning" },
                  { value: "afternoon", label: "Afternoon" },
                ]}
                value={portion}
                onChange={setPortion}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <Toggle label="First day: afternoon only" checked={startHalf} onChange={setStartHalf} />
                <Toggle label="Last day: morning only" checked={endHalf} onChange={setEndHalf} />
              </div>
            )
          ) : null}

          {needsChild ? (
            <>
              <SegmentedControl
                name="childOrder"
                label="Which child"
                options={[
                  { value: "first_or_second", label: "1st or 2nd" },
                  { value: "later", label: "3rd or later" },
                ]}
                value={childOrder}
                onChange={setChildOrder}
              />
              <TextField
                name="eventDate"
                label={leaveType === "paternity" ? "Date of the birth" : "Date of the birth (expected is fine)"}
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
              />
            </>
          ) : (
            <input type="hidden" name="childOrder" value="" />
          )}

          <TextField
            name="note"
            label={forName ? "Note (optional)" : "Note for your admin (optional)"}
            autoComplete="off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
          />

          {/* Kept in view while the calendar scrolls: the consequence and the one action. */}
          <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-separator/60 bg-surface px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {start && end ? (
              <p className="text-body font-semibold tabular">
                {formatSpan(start, end)}
                {assessment && "days" in assessment && assessment.days !== undefined ? ` · ${formatDays(assessment.days)}` : ""}
              </p>
            ) : null}
            <p aria-live="polite" className={`min-h-6 text-body text-pretty ${assessment && !assessment.ok ? "text-danger" : "text-label-secondary"}`}>
              {assessment && !assessment.ok ? assessment.reason : consequence()}
            </p>
            {state.status === "error" ? (
              <p role="alert" className="text-secondary text-danger">
                {state.message}
              </p>
            ) : null}
            <Button type="submit" fullWidth disabled={pending || !assessment?.ok} aria-busy={pending || undefined}>
              {pending ? "Sending…" : submitLabel}
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-body">
      {label}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-[31px] w-[51px] shrink-0 cursor-pointer appearance-none rounded-full bg-fill transition-colors duration-200 before:block before:size-[27px] before:translate-x-[2px] before:rounded-full before:bg-on-accent before:shadow-sm before:transition-transform motion-reduce:before:transition-none before:duration-200 before:ease-(--ease-out) checked:bg-success checked:before:translate-x-[22px] focus-visible:outline-2 focus-visible:outline-accent"
      />
    </label>
  );
}
