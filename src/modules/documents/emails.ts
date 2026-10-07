import { type Email, compose } from "@/lib/email-layout";
import { formatDays, formatNu, formatSpan } from "@/lib/format";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import type { Chhertum, LeaveType } from "@/modules/rules/types";

// The emails DashTeam sends about payslips and leave. Laid out by lib/email-layout.

const leaveName = (leaveType: LeaveType) => LEAVE_TYPE_NAME[leaveType].toLowerCase();

export function payslipEmail(input: { firstName: string; monthName: string; takeHome: Chhertum; adminFirstName: string; reason: "issued" | "asked" }): Email {
  return compose(`Your ${input.monthName} payslip`, {
    lead:
      input.reason === "asked"
        ? `Hi ${input.firstName}. Here’s your payslip for ${input.monthName}, as you asked.`
        : `Hi ${input.firstName}, your payslip for ${input.monthName} is attached.`,
    highlight: { label: "Take-home", value: formatNu(input.takeHome) },
    footnote: `If anything looks wrong, let ${input.adminFirstName} know.`,
  });
}

export function leaveRequestedEmail(input: { personName: string; leaveType: LeaveType; days: number; startDate: string; endDate: string; note: string; url: string }): Email {
  const first = input.personName.trim().split(/\s+/)[0] ?? input.personName;
  const what = `${formatDays(input.days)} of ${leaveName(input.leaveType)}`;
  return compose(`${first} asked for ${what}`, {
    lead: `${input.personName} asked for ${what}, ${formatSpan(input.startDate, input.endDate)}.`,
    paragraphs: input.note ? [`Their note: ${input.note}`] : [],
    link: { label: "Approve or decline it in DashTeam", url: input.url },
  });
}

export function leaveDecidedEmail(input: {
  firstName: string;
  decision: "approved" | "declined";
  leaveType: LeaveType;
  days: number;
  startDate: string;
  endDate: string;
  note: string;
  adminFirstName: string;
  url: string;
}): Email {
  const name = leaveName(input.leaveType);
  const span = formatSpan(input.startDate, input.endDate);
  const paragraphs = input.note ? [`${input.adminFirstName}’s note: ${input.note}`] : [];
  const link = { label: "See your leave", url: input.url };
  if (input.decision === "approved") {
    return compose(`Your ${name} is approved`, { lead: `Hi ${input.firstName}, your ${name} on ${span} is approved (${formatDays(input.days)}).`, paragraphs, link });
  }
  return compose(`Your ${name} wasn’t approved`, { lead: `Hi ${input.firstName}, your ${name} on ${span} was declined.`, paragraphs, link });
}

export type { Email };
