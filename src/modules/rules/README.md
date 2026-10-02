# rules

Every rate and setting, dated with `effective_from` (always the 1st of a month) and attached to an employment type.

- `public.rules` is append-only: updates are rejected, and a rule already in force cannot be deleted. A change is a new row with a later date.
- `resolveRules(rows, employmentType, month)` picks, for each key, the latest row in force on the 1st of the month. A missing rule is an error.
- Values are stored as snake_case jsonb in chhertum and basis points, and validated by `schema.ts`.
- `v1.ts` mirrors the V1 migration; `tests/db/rules.test.ts` fails if they differ.
