// Local Supabase sends auth email to Mailpit instead of the internet.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSearch = { messages: { ID: string; Created: string }[] };
type MailpitMessage = { Text: string; HTML: string };

export async function latestSignInCode(email: string, after: Date): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as MailpitSearch;
    const fresh = search.messages.find((message) => new Date(message.Created) >= after);
    if (fresh) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as MailpitMessage;
      const code = (message.Text || message.HTML).match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in code arrived for ${email}`);
}
