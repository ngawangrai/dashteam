// The day the filing tests play, and the reminder job's secret, shared by playwright.config.ts (which
// passes them to the test server) and the specs. The server honours the date only with ALLOW_TEST_CLOCK.

const thimphu = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu" }).format(new Date()));
const dayOfNextMonth = (day: number) => new Date(Date.UTC(thimphu.getUTCFullYear(), thimphu.getUTCMonth() + 1, day)).toISOString().slice(0, 10);

/** The 5th of next month: this month's TDS is due in 5 days, and the 5th is a reminder day. */
export const FILING_TODAY = dayOfNextMonth(5);
export const NOT_A_REMINDER_DAY = dayOfNextMonth(6);
export const NEXT_REMINDER_DAY = dayOfNextMonth(8);
export const TEST_CRON_SECRET = "test-cron-secret-0123456789abcdef0123456789abcdef";
