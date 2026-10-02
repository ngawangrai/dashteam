# payroll

The payroll calculation. Pure functions: one person's pay inputs and the resolved rules in, a result out.

Order: prorate regular pay → gross → HC → PF → GIS → taxable → TDS → take-home (minus recoveries).
Rounding happens only where the rules say, and each rounding point is listed in `calculate.ts`.

- Imports only its own files, `@/modules/rules/types` and `zod` (ESLint and `boundary.test.ts` enforce this).
- No number other than 0, 1 or 2 appears in the code: every rate, edge and unit comes from the rules.
- Money is integer chhertum; rounding uses bigint so no float touches money.
- `pnpm test:payroll` runs the DRC fixture (all 1,319 rows) and the calculation tests.
