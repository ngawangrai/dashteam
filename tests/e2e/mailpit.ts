// Local Supabase sends auth email to Mailpit instead of the internet.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSearch = { messages: { ID: string; Created: string }[] };
type MailpitMessage = { Text: string; HTML: string };

export async function latestSignInCode(email: string, after: Date): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as MailpitSearch;
    // Payslip and leave emails go to the same people, so look past them for the newest code.
    for (const fresh of search.messages.filter((message) => new Date(message.Created) >= after)) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as MailpitMessage;
      if (!/sign-in code/i.test(message.Text || message.HTML)) continue;
      const code = (message.Text || message.HTML).match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in code arrived for ${email}`);
}

type MailpitSummary = { ID: string; Created: string; Subject: string; Attachments: number; To: { Address: string }[] };

/** Every email to an address since a moment, newest first. */
export async function emailsTo(email: string, after: Date): Promise<MailpitSummary[]> {
  const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=200`)).json()) as { messages: MailpitSummary[] };
  return search.messages.filter((message) => new Date(message.Created) >= after);
}

/** Waits until an address has received `count` emails matching a subject since a moment. */
export async function waitForEmails(email: string, after: Date, subject: string | RegExp, count = 1, timeoutMs = 20_000): Promise<MailpitSummary[]> {
  const matches = (list: MailpitSummary[]) => list.filter((m) => (typeof subject === "string" ? m.Subject === subject : subject.test(m.Subject)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = matches(await emailsTo(email, after));
    if (found.length >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return matches(await emailsTo(email, after));
}

/** An email's text and attachments. */
export async function emailDetail(id: string): Promise<{ Text: string; Attachments: { FileName: string; ContentType: string; Size: number }[] }> {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string; Attachments: { FileName: string; ContentType: string; Size: number }[] };
}

/** Emails to an address since a moment whose subject and text match, waiting up to the timeout for at least one. */
export async function emailsAbout(email: string, after: Date, subject: string | RegExp, text: string, timeoutMs = 0): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const candidates = (await emailsTo(email, after)).filter((m) => (typeof subject === "string" ? m.Subject === subject : subject.test(m.Subject)));
    const matching: string[] = [];
    for (const message of candidates) if ((await emailDetail(message.ID)).Text.includes(text)) matching.push(message.ID);
    if (matching.length || Date.now() >= deadline) return matching;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
