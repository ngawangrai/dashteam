// Checks that a database is reachable before a workflow uses it, and says plainly why not.
// A free Supabase project pauses after a week without activity, and the CLI then reports only a
// connection failure; this names the real cause and the fix.
//
// Usage (GitHub Actions): node scripts/ci/check-database.ts <VARIABLE_NAME> <label>
// The URL is read from the named variable and never printed. Runs on Node 24 with type stripping,
// so it uses erasable TypeScript only.
import { appendFileSync } from "node:fs";
import { resolve4, resolve6 } from "node:dns/promises";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

export type Target = { ref: string | null; sharedPooler: boolean };

const REF = /^[a-z0-9]{20}$/;

/** Reads the Supabase project ref from a connection string, or says what's wrong with its form. */
export function parseTarget(raw: string): Target | { problem: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { problem: "isn't a valid connection string. Copy the Session pooler string from Supabase → Connect." };
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    return { problem: "should start with postgresql://. Copy the Session pooler string from Supabase → Connect." };
  }
  const sharedPooler = url.hostname.endsWith(".pooler.supabase.com");
  const fromUser = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1];
  const fromHost = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1];
  if (sharedPooler && !fromUser) {
    return { problem: "uses the shared pooler but its user isn't postgres.<project ref>. Copy the Session pooler string from Supabase → Connect." };
  }
  const ref = fromUser ?? fromHost ?? null;
  if (ref !== null && !REF.test(ref)) {
    return { problem: "has a project ref that doesn't look right. Copy the Session pooler string from Supabase → Connect." };
  }
  return { ref, sharedPooler };
}

/** A paused (or deleted) project's own hostname stops resolving; an active one resolves. */
export function pausedMessage(label: string): string {
  return (
    `The ${label} project looks paused. Free Supabase projects pause after 7 days without activity. ` +
    `Restore it in Supabase (open the project, then Restore project), wait until it shows Healthy, then run this workflow again.`
  );
}

type ErrorLike = { code?: unknown; message?: unknown };

/** Turns a connection error into what happened and what to do, without the connection string. */
export function explainConnectionError(error: unknown, label: string): string {
  const { code, message } = (typeof error === "object" && error !== null ? error : {}) as ErrorLike;
  const text = typeof message === "string" ? message.replace(/postgres(ql)?:\/\/\S+/g, "[connection string]") : String(error);
  if (code === "28P01" || /password authentication failed/i.test(text)) {
    return `The ${label} database turned the password down. Copy the Session pooler string again from Supabase → Connect (reset the database password there if you need to), and update the secret.`;
  }
  if (/tenant or user not found/i.test(text)) {
    return `The ${label} pooler doesn't know this user. The user must be postgres.<project ref> for the right project. Copy the Session pooler string again from Supabase → Connect.`;
  }
  if (code === "CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
    return `The ${label} database didn't answer within 20 seconds. If the project was just restored, wait a few minutes and run this workflow again.`;
  }
  if (code === "ENOTFOUND") {
    return `The ${label} database host doesn't exist. Copy the Session pooler string again from Supabase → Connect.`;
  }
  if (code === "ECONNREFUSED") {
    return `The ${label} database refused the connection. Check the port: the Session pooler uses 5432.`;
  }
  return `The ${label} database couldn't be reached: ${text}`;
}

async function hostResolves(host: string): Promise<boolean | null> {
  const results = await Promise.allSettled([resolve4(host), resolve6(host)]);
  if (results.some((result) => result.status === "fulfilled")) return true;
  const codes = results.map((result) => (result.status === "rejected" ? (result.reason as ErrorLike).code : undefined));
  // NXDOMAIN means the name is gone. Anything else (a DNS hiccup) proves nothing, so the
  // connection attempt below decides.
  return codes.every((code) => code === "ENOTFOUND") ? false : null;
}

/** Returns null when the database answers, otherwise the message to show. */
export async function checkDatabase(raw: string, label: string): Promise<string | null> {
  const target = parseTarget(raw);
  if ("problem" in target) return `The ${label} connection string ${target.problem}`;
  if (target.ref && (await hostResolves(`db.${target.ref}.supabase.co`)) === false) return pausedMessage(label);

  const sql = postgres(raw, {
    max: 1,
    connect_timeout: 20,
    prepare: false,
    // Hosted projects always get TLS, so the password never crosses the network in the clear.
    ssl: target.ref ? "require" : false,
    onnotice: () => {},
  });
  try {
    await sql`select 1`;
    return null;
  } catch (error) {
    return explainConnectionError(error, label);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const [variable, label] = process.argv.slice(2);
  if (!variable || !label) {
    console.error("Usage: node scripts/ci/check-database.ts <VARIABLE_NAME> <label>");
    process.exit(2);
  }
  const raw = process.env[variable] ?? "";
  const problem = raw ? await checkDatabase(raw, label) : `${variable} is empty, so there's no ${label} database to check.`;
  if (problem === null) {
    console.log(`The ${label} database is reachable.`);
    return;
  }
  const title = `${label[0]?.toUpperCase() ?? ""}${label.slice(1)} database`;
  console.log(`::error title=${title}::${problem}`);
  if (process.env.RUNNER_TEMP) appendFileSync(`${process.env.RUNNER_TEMP}/alert.txt`, `${problem}\n`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
