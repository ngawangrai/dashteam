import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env/server";
import { filingToday } from "@/modules/filing/repository";
import { sendFilingReminders } from "@/modules/filing/reminders-job";

// Called once a day by .github/workflows/filing-reminders.yml with `Authorization: Bearer <CRON_SECRET>`.
// Without the secret (or with no secret configured) it refuses, the same way every time.

function authorised(request: Request): boolean {
  const secret = serverEnv.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !given) return false;
  // Compare digests, so the comparison takes the same time whatever was sent.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

export async function POST(request: Request) {
  if (!authorised(request)) return Response.json({ error: "Not allowed." }, { status: 401 });
  // Tests may play a given day; only when the test clock is allowed (see FILING_TODAY in lib/env).
  const asked = new URL(request.url).searchParams.get("today");
  const today = process.env.ALLOW_TEST_CLOCK === "1" && asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : filingToday();
  const outcome = await sendFilingReminders(today);
  if (!outcome.sent && outcome.reason === "send_failed") return Response.json(outcome, { status: 502 });
  return Response.json(outcome);
}
