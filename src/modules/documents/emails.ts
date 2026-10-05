import { formatDays, formatNu, formatSpan } from "@/lib/format";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import type { Chhertum, LeaveType } from "@/modules/rules/types";

// The emails DashTeam sends, as subject, plain text and HTML. They look like the sign-in email
// (supabase/templates/sign-in-code.html): one white card on grey, the system font, a quiet "DashTeam"
// above. Mail apps that support dark mode get a dark card; the rest show the light one, which reads in
// either. No images, so nothing is blocked. The text version says the same words in the same order.

export type Email = { subject: string; text: string; html: string };

type Content = {
  lead: string;
  /** One figure worth seeing at a glance, shown large: the take-home. */
  highlight?: { label: string; value: string };
  paragraphs?: string[];
  link?: { label: string; url: string };
  footnote?: string;
};

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DARK = `@media (prefers-color-scheme: dark) {
  .page { background: #000000 !important; }
  .card { background: #1c1c1e !important; }
  .ink { color: #f5f5f7 !important; }
  .muted { color: #a1a1a6 !important; }
  .link { color: #4c9aff !important; }
}`;

function compose(subject: string, content: Content): Email {
  const text = [
    content.lead,
    ...(content.highlight ? [`${content.highlight.label}: ${content.highlight.value}`] : []),
    ...(content.paragraphs ?? []),
    ...(content.link ? [`${content.link.label}: ${content.link.url}`] : []),
    ...(content.footnote ? [content.footnote] : []),
  ].join("\n\n");

  const p = (body: string, style: string, cls = "ink") => `<p class="${cls}" style="margin:0 0 16px;${style}">${body}</p>`;
  const html = [
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escape(subject)}</title>`,
    `<style>:root { color-scheme: light dark; } ${DARK}</style></head>`,
    `<body class="page" style="margin:0;padding:32px 16px;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro','Inter',sans-serif;color:#1c1c1e;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;"><tr><td style="padding:32px 24px;">`,
    p("DashTeam", "margin-bottom:8px;font-size:15px;color:#6c6c70;", "muted"),
    p(escape(content.lead), "font-size:17px;line-height:22px;color:#1c1c1e;"),
    content.highlight
      ? p(escape(content.highlight.label), "margin-bottom:0;font-size:15px;color:#6c6c70;", "muted") +
        p(escape(content.highlight.value), "margin-bottom:24px;font-size:34px;line-height:41px;font-weight:700;font-variant-numeric:tabular-nums;color:#1c1c1e;")
      : "",
    ...(content.paragraphs ?? []).map((paragraph) => p(escape(paragraph), "font-size:17px;line-height:22px;color:#1c1c1e;")),
    content.link
      ? p(`<a class="link" href="${escape(content.link.url)}" style="color:#0a66d8;">${escape(content.link.label)}</a>`, "font-size:17px;line-height:22px;")
      : "",
    content.footnote ? p(escape(content.footnote), "margin-bottom:0;font-size:13px;line-height:18px;color:#6c6c70;", "muted") : "",
    `</td></tr></table></body></html>`,
  ].join("");
  return { subject, text, html };
}

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
