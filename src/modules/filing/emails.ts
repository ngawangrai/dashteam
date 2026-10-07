import { type Email, compose } from "@/lib/email-layout";
import { formatLongDate, formatMonth, formatNu } from "@/lib/format";
import type { Chhertum, PayrollMonth } from "@/modules/rules/types";
import { type DueStatus, dueStatus } from "./due";

// The reminder admins get on the reminder days while a month's TDS isn't marked filed.

export type ReminderMonth = { month: PayrollMonth; dueDate: string; remit: Chhertum | null; locked: boolean };

export function dueWords(status: DueStatus): string {
  if (status.kind === "today") return "due today";
  if (status.kind === "overdue") return `overdue by ${status.days === 1 ? "1 day" : `${status.days} days`}`;
  return `due in ${status.days === 1 ? "1 day" : `${status.days} days`}`;
}

const withoutYear = (date: string) => formatLongDate(date).replace(/ \d{4}$/, "");

export function filingReminderEmail(input: { today: string; months: ReminderMonth[]; url: string }): Email {
  const footnote = "Reminders stop once you mark it filed.";
  const [only] = input.months;
  if (input.months.length === 1 && only) {
    const name = formatMonth(only.month);
    return compose(`${name} TDS is ${dueWords(dueStatus(input.today, only.dueDate))}`, {
      lead: `${name}’s TDS and HC need filing with DRC by ${withoutYear(only.dueDate)}.`,
      ...(only.locked && only.remit !== null ? { highlight: { label: "To pay", value: formatNu(only.remit) } } : {}),
      paragraphs: only.locked ? [] : [`Lock ${name} payroll first, then file it.`],
      link: { label: `Open ${name}’s filing in DashTeam`, url: input.url },
      footnote,
    });
  }
  return compose(`TDS for ${input.months.length} months needs filing`, {
    lead: "These months still need filing with DRC:",
    paragraphs: input.months.map((m) => {
      const what = m.locked && m.remit !== null ? formatNu(m.remit) : "not locked yet";
      return `${formatMonth(m.month)}: ${what}, ${dueWords(dueStatus(input.today, m.dueDate))}.`;
    }),
    link: { label: "Open filing in DashTeam", url: input.url },
    footnote: "Reminders stop once each is marked filed.",
  });
}
