import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // CLAUDE.md hard rule 8: TPN and bank details must never reach a log, so the app does not log at all.
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-console": "error" },
  },
  {
    // CLAUDE.md hard rules 1 and 3: the payroll module is pure and holds no rates.
    // It imports only its own files, rules types and zod; every number it uses comes from the rules.
    files: ["src/modules/payroll/**/*.ts"],
    ignores: ["src/modules/payroll/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.{1,2}/|@/modules/rules/types$|zod$).*",
              message: "modules/payroll may import only its own files, @/modules/rules/types and zod.",
            },
          ],
        },
      ],
      // Any number other than 0, 1 or 2 (also as bigint) is a value that belongs in the rules.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[raw=/^(?!(?:0|1|2)n?$)[0-9.]/]",
          message: "No numbers in modules/payroll: rates, bands and settings come from the rules (0, 1 and 2 are allowed).",
        },
      ],
    },
  },
);
