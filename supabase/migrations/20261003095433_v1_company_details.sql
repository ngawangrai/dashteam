-- Company details on documents, in force from January 2026. Mirrors src/modules/rules/v1.ts
-- (V1_COMPANY_RULE_ROWS); tests/db/rules.test.ts fails if the two ever differ. The name only for now:
-- the address and logo are added later as a new dated row, picked up by payslips from that month.
insert into public.rules (key, employment_type, effective_from, value, note) values
  ('company_details', 'full_time', '2026-01-01', '{"name":"Xceed Studio","address_lines":[],"show_logo":false}'::jsonb, 'Company details on documents. Address and logo to follow'),
  ('company_details', 'intern', '2026-01-01', '{"name":"Xceed Studio","address_lines":[],"show_logo":false}'::jsonb, 'Company details on documents. Address and logo to follow');
