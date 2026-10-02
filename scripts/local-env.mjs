// Writes .env.local from the running local Supabase stack, so a fresh clone needs no copying of keys.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

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

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY ?? status.ANON_KEY}`,
  `DATABASE_URL=${status.DB_URL}`,
];
writeFileSync(".env.local", `${lines.join("\n")}\n`);
console.log("Wrote .env.local for the local Supabase stack.");
