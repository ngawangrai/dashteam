import type { Chhertum, PayrollMonth, PlainDate } from "@/modules/rules/types";

// Display helpers. Money is shown the way DRC writes it: Nu. 1,25,000 (Indian digit grouping).

const CH_PER_NU = 100;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${lastThree}`;
}

/** Nu. 1,25,000 — chhertum shown only when there are any (Nu. 450.50). */
export function formatNu(chhertum: Chhertum): string {
  const sign = chhertum < 0 ? "−" : "";
  const absolute = Math.abs(chhertum);
  const whole = Math.floor(absolute / CH_PER_NU);
  const part = absolute % CH_PER_NU;
  const decimals = part === 0 ? "" : `.${String(part).padStart(2, "0")}`;
  return `${sign}Nu. ${groupIndian(String(whole))}${decimals}`;
}

/** "1,25,000" or "450.50" as typed into a field → chhertum, or null if it isn't an amount. */
export function parseNu(text: string): Chhertum | null {
  const cleaned = text.trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const part = Number((match[2] ?? "").padEnd(2, "0"));
  const value = whole * CH_PER_NU + part;
  return Number.isSafeInteger(value) ? value : null;
}

/** 17112233 → 17 11 22 33 */
export function formatPhone(phone: string): string {
  return /^\d{8}$/.test(phone) ? phone.replace(/(\d{2})(?=\d)/g, "$1 ") : phone;
}

export function maskedLast4(last4: string): string {
  return `••••${last4}`;
}

/** 2025-03-03 → 3 Mar 2025 */
export function formatDate(date: PlainDate | string): string {
  const [year, month, day] = date.split("-").map(Number);
  const name = MONTHS[(month ?? 1) - 1]?.slice(0, 3) ?? "";
  return `${day} ${name} ${year}`;
}

/** 2026-10-31 → 31 October 2026 */
export function formatLongDate(date: PlainDate | string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1] ?? ""} ${year}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 2026-10-07 → Wed 7 Oct */
export function formatDay(date: PlainDate | string, options: { long?: boolean } = {}): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  if (options.long) return `${WEEKDAYS_LONG[weekday]} ${day} ${MONTHS[(month ?? 1) - 1] ?? ""}`;
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[(month ?? 1) - 1]?.slice(0, 3) ?? ""}`;
}

/** A leave span in words: "Wed 7 Oct", "Wed 7 – Fri 9 Oct", "Wed 30 Dec – Fri 8 Jan". */
export function formatSpan(start: string, end: string): string {
  if (start === end) return formatDay(start);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const first = sameMonth ? formatDay(start).replace(/ \w+$/, "") : formatDay(start);
  return `${first} – ${formatDay(end)}`;
}

/** 0.5 → "½ day", 1 → "1 day", 3.5 → "3½ days" */
export function formatDays(days: number): string {
  const whole = Math.floor(days);
  const half = days - whole === 0.5 ? "½" : "";
  const number = whole === 0 && half ? "½" : `${whole}${half}`;
  return `${number} ${days <= 1 ? "day" : "days"}`;
}

export function formatMonth({ year, month }: PayrollMonth, options: { withYear?: boolean } = {}): string {
  const name = MONTHS[month - 1] ?? "";
  return options.withYear ? `${name} ${year}` : name;
}

export function firstOfMonth({ year, month }: PayrollMonth): PlainDate {
  return `${year}-${String(month).padStart(2, "0")}-01` as PlainDate;
}

export function monthOf(date: PlainDate | string): PayrollMonth {
  const [year, month] = date.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1 };
}

export function addMonths({ year, month }: PayrollMonth, count: number): PayrollMonth {
  const index = year * 12 + (month - 1) + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Today in Thimphu, as a calendar date. */
export function thimphuToday(now: Date = new Date()): PlainDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu" }).format(now) as PlainDate;
}

/** "?month=2026-10" → that month; anything else → this month. */
export function monthFromParam(param: string | undefined, today: string): PayrollMonth {
  return param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? monthOf(`${param}-01`) : monthOf(today);
}

export function monthBounds({ year, month }: PayrollMonth): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}` };
}
