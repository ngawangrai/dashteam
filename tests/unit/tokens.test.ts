import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi)) {
    const [, name, hex] = match;
    if (name && hex) tokens[name] = hex;
  }
  return tokens;
}

const lightBlock = css.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
const darkBlock = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const textTokens = ["label", "label-secondary", "accent", "success", "warning", "danger"];
const backgrounds = ["bg", "surface"];

describe.each([
  ["light", tokensIn(lightBlock)],
  ["dark", tokensIn(darkBlock)],
])("%s mode colours", (_mode, tokens) => {
  it("defines every token", () => {
    for (const name of [...textTokens, ...backgrounds, "accent-fill", "on-accent", "fill"]) {
      expect(tokens[name], name).toMatch(/^#/);
    }
  });

  it.each(textTokens.flatMap((text) => backgrounds.map((bg) => [text, bg] as const)))(
    "%s on %s meets WCAG AA (4.5:1)",
    (text, bg) => {
      expect(contrast(tokens[text] ?? "", tokens[bg] ?? "")).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("button text on the accent fill meets WCAG AA", () => {
    expect(contrast(tokens["on-accent"] ?? "", tokens["accent-fill"] ?? "")).toBeGreaterThanOrEqual(4.5);
  });

  it("text on the input fill stays readable", () => {
    expect(contrast(tokens.label ?? "", tokens.fill ?? "")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["label-secondary"] ?? "", tokens.fill ?? "")).toBeGreaterThanOrEqual(4.5);
  });
});
