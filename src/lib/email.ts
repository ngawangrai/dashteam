import "server-only";
import { serverEnv } from "@/lib/env/server";

// Sending one email. Production goes through Resend's REST API (no SDK needed); local development and
// CI go to Mailpit, so tests can read what was sent. Nothing here logs: payslips carry pay figures.

export type Attachment = { filename: string; content: Buffer; contentType: string };

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Attachment[];
  /** The same key never sends twice (Resend keeps it for 24 hours), so a retry after a crash is safe. */
  idempotencyKey: string;
};

export type SendResult = { ok: true; providerId: string } | { ok: false; error: string };

/** Addresses at this domain fail on purpose, locally only, so tests can exercise a failed send. */
const FAILING_DOMAIN = "@fail.dashteam.local";

function parseFrom(from: string): { name?: string; email: string } {
  const match = /^(.*)<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1]?.trim() || undefined, email: match[2]?.trim() ?? from } : { email: from.trim() };
}

async function sendWithResend(email: OutgoingEmail, apiKey: string): Promise<SendResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": email.idempotencyKey },
    body: JSON.stringify({
      from: serverEnv.EMAIL_FROM,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: email.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64"), content_type: a.contentType })),
    }),
  });
  if (response.ok) {
    const body = (await response.json()) as { id?: string };
    return { ok: true, providerId: body.id ?? "" };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: "The email service refused our key. Check the Resend settings." };
  if (response.status === 422) return { ok: false, error: "The email service couldn’t send to this address. Check it on their page." };
  if (response.status === 429) return { ok: false, error: "Too many emails at once. Try again in a minute." };
  return { ok: false, error: "The email service didn’t answer. Try again in a minute." };
}

async function sendWithMailpit(email: OutgoingEmail, mailpitUrl: string): Promise<SendResult> {
  if (email.to.toLowerCase().endsWith(FAILING_DOMAIN)) return { ok: false, error: "The email service couldn’t send to this address. Check it on their page." };
  const from = parseFrom(serverEnv.EMAIL_FROM);
  const response = await fetch(`${mailpitUrl}/api/v1/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: { Email: from.email, Name: from.name ?? "" },
      To: [{ Email: email.to }],
      Subject: email.subject,
      Text: email.text,
      HTML: email.html,
      Headers: { "X-Idempotency-Key": email.idempotencyKey },
      Attachments: email.attachments?.map((a) => ({ Filename: a.filename, Content: a.content.toString("base64"), ContentType: a.contentType })),
    }),
  });
  if (!response.ok) return { ok: false, error: "The email service didn’t answer. Try again in a minute." };
  const body = (await response.json()) as { ID?: string };
  return { ok: true, providerId: body.ID ?? "" };
}

export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  try {
    if (serverEnv.RESEND_API_KEY) return await sendWithResend(email, serverEnv.RESEND_API_KEY);
    if (serverEnv.MAILPIT_URL) return await sendWithMailpit(email, serverEnv.MAILPIT_URL);
    return { ok: false, error: "Email isn’t set up yet. Add the Resend key, then try again." };
  } catch {
    return { ok: false, error: "The email service didn’t answer. Try again in a minute." };
  }
}
