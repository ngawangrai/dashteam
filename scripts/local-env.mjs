// Writes .env.local from the running local Supabase stack, so a fresh clone needs no copying of keys.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env.local") && !process.argv.includes("--force")) {
  console.log(".env.local already exists. Run with --force to overwrite it.");
  process.exit(0);
}

let status;
try {
  status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { encoding: "utf8" }));
} catch {
  console.error("Local Supabase isn't running. Start Docker, then run `pnpm db:start`.");
  process.exit(1);
}

// Keep an existing local encryption key: a new one would make locally saved TPNs and accounts unreadable.
const existingKey = existsSync(".env.local")
  ? /^FIELD_ENCRYPTION_KEY=(.+)$/m.exec(readFileSync(".env.local", "utf8"))?.[1]
  : undefined;

// The Data API is off (supabase/config.toml), so `supabase status` no longer prints API_URL. Auth is
// still served on the [api] port, so build the address from that.
const apiPort = /^\[api\][^[]*?^port\s*=\s*(\d+)/ms.exec(readFileSync("supabase/config.toml", "utf8"))?.[1] ?? "54321";
const supabaseUrl = status.API_URL ?? `http://127.0.0.1:${apiPort}`;

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY ?? status.ANON_KEY}`,
  `DATABASE_URL=${status.DB_URL}`,
  `SUPABASE_SECRET_KEY=${status.SECRET_KEY ?? status.SERVICE_ROLE_KEY}`,
  `FIELD_ENCRYPTION_KEY=${existingKey ?? randomBytes(32).toString("base64")}`,
];
writeFileSync(".env.local", `${lines.join("\n")}\n`);
console.log("Wrote .env.local for the local Supabase stack.");
