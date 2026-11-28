// Writes .env.local from the running local Supabase stack, so a fresh clone needs no copying of keys.
// On an existing .env.local it adds only the settings that are missing and never changes one that is
// there. With --force it also refreshes the values that come from the stack; the encryption key and
// the cron secret are always kept, since a new key would make locally saved TPNs and accounts unreadable.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const force = process.argv.includes("--force");

let status;
try {
  status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { encoding: "utf8" }));
} catch {
  console.error("Local Supabase isn't running. Start Docker, then run `pnpm db:start`.");
  process.exit(1);
}

// The Data API is off (supabase/config.toml), so `supabase status` no longer prints API_URL. Auth is
// still served on the [api] port, so build the address from that.
const apiPort = /^\[api\][^[]*?^port\s*=\s*(\d+)/ms.exec(readFileSync("supabase/config.toml", "utf8"))?.[1] ?? "54321";

/** Values read from the local stack: refreshed with --force. */
const fromStack = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL ?? `http://127.0.0.1:${apiPort}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  DATABASE_URL: status.DB_URL,
  SUPABASE_SECRET_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
};

/** Values made once and then kept. */
const madeOnce = {
  FIELD_ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
  CRON_SECRET: () => randomBytes(32).toString("hex"),
  EMAIL_FROM: () => "Xceed Studio <payroll@dashteam.local>",
  APP_URL: () => "http://localhost:3000",
};

const text = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const lines = text === "" ? [] : text.replace(/\n+$/, "").split("\n");
const indexOf = (name) => lines.findIndex((line) => line.startsWith(`${name}=`));

const added = [];
const refreshed = [];
for (const [name, value] of Object.entries(fromStack)) {
  const at = indexOf(name);
  if (at === -1) {
    lines.push(`${name}=${value}`);
    added.push(name);
  } else if (force && lines[at] !== `${name}=${value}`) {
    lines[at] = `${name}=${value}`;
    refreshed.push(name);
  }
}
for (const [name, make] of Object.entries(madeOnce)) {
  if (indexOf(name) === -1) {
    lines.push(`${name}=${make()}`);
    added.push(name);
  }
}

if (!added.length && !refreshed.length) {
  console.log(".env.local already has every setting.");
  process.exit(0);
}
writeFileSync(".env.local", `${lines.join("\n")}\n`);
if (added.length) console.log(`Added to .env.local: ${added.join(", ")}.`);
if (refreshed.length) console.log(`Refreshed from the local stack: ${refreshed.join(", ")}.`);
