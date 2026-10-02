import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md hard rule 3: modules/payroll is pure. No database, network, UI or other modules, only rules types.
// ESLint enforces the same in eslint.config.mjs; this test keeps it true even if the lint config drifts.

const ALLOWED = [/^\.\.?\//, /^@\/modules\/rules\/types$/, /^zod$/];

const dir = join(process.cwd(), "src/modules/payroll");
const sources = readdirSync(dir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));

function importsOf(source: string): string[] {
  const specifiers = [...source.matchAll(/(?:import|export)[^'"]*?from\s*["']([^"']+)["']/g), ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)];
  return specifiers.map((match) => match[1] ?? "");
}

describe("payroll module boundary", () => {
  it("has source files to check", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)("%s imports only rules types, zod and its own files", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    const disallowed = importsOf(source).filter((specifier) => !ALLOWED.some((pattern) => pattern.test(specifier)));
    expect(disallowed).toEqual([]);
    expect(source).not.toMatch(/\brequire\(|\bfetch\(|process\.env/);
  });
});
