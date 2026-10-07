-- Filing settings, in force from January 2026. Mirrors src/modules/rules/v1.ts (V1_FILING_RULE_ROWS);
-- tests/db/rules.test.ts fails if the two ever differ. Company-wide, so stored for both employment types.
insert into public.rules (key, employment_type, effective_from, value, note) values
  ('filing_settings', 'full_time', '2026-01-01', '{"reminder_days":[5,8,10]}'::jsonb, 'TDS filing reminders on the 5th, 8th and 10th until the month is filed'),
  ('filing_settings', 'intern', '2026-01-01', '{"reminder_days":[5,8,10]}'::jsonb, 'TDS filing reminders on the 5th, 8th and 10th until the month is filed');
