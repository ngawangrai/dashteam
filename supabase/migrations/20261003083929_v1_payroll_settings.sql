-- Payroll settings, in force from January 2026. Mirrors src/modules/rules/v1.ts (V1_SETTINGS_RULE_ROWS);
-- tests/db/rules.test.ts fails if the two ever differ. Company-wide, so stored for both employment types.
-- No first month yet: the admin chooses it on the Payroll screen.
insert into public.rules (key, employment_type, effective_from, value, note) values
  ('payroll_settings', 'full_time', '2026-01-01', '{"first_month":null,"large_change_bp":1000,"due_day":10}'::jsonb, 'Payroll settings. First month not set yet; flag a 10% change; TDS and HC due on the 10th'),
  ('payroll_settings', 'intern', '2026-01-01', '{"first_month":null,"large_change_bp":1000,"due_day":10}'::jsonb, 'Payroll settings. First month not set yet; flag a 10% change; TDS and HC due on the 10th');
