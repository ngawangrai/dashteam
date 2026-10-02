-- V1 rules from docs/PRD.md, in force from January 2026. Mirrors src/modules/rules/v1.ts;
-- tests/db/rules.test.ts fails if the two ever differ. Values are chhertum and basis points.
-- Placeholders awaiting the accountant: HC rounding (nearest), HC on intern stipends (on), interns on IT-1(a) (include).
insert into public.rules (key, employment_type, effective_from, value, note) values
  ('tds', 'full_time', '2026-01-01', '{"bands": [{"from_annual_ch": 0, "rate_bp": 0}, {"from_annual_ch": 30000000, "rate_bp": 1000}, {"from_annual_ch": 40000000, "rate_bp": 1500}, {"from_annual_ch": 65000000, "rate_bp": 2000}, {"from_annual_ch": 100000000, "rate_bp": 2500}, {"from_annual_ch": 150000000, "rate_bp": 3000}], "months_per_year": 12, "taxable_round_up_to_ch": 10000, "result_round_to_ch": 100, "result_rounding": "nearest"}'::jsonb, 'DRC Annexure III, revised TDS schedule for monthly salary income'),
  ('health_contribution', 'full_time', '2026-01-01', '{"enabled": true, "rate_bp": 100, "round_to_ch": 100, "rounding": "nearest"}'::jsonb, 'Health contribution, 1% of gross. Rounding to confirm with the accountant'),
  ('provident_fund', 'full_time', '2026-01-01', '{"enabled": false}'::jsonb, 'Off until NPPF registration (2027)'),
  ('gis', 'full_time', '2026-01-01', '{"amount_ch": 0}'::jsonb, 'Not applicable to Xceed'),
  ('proration', 'full_time', '2026-01-01', '{"basis": "calendar_days", "round_to_ch": 100, "rounding": "nearest"}'::jsonb, 'Calendar days, basic + allowances or stipend'),
  ('it1a_inclusion', 'full_time', '2026-01-01', '{"include": true}'::jsonb, 'Include interns on IT-1(a). To confirm with the accountant'),
  ('tds', 'intern', '2026-01-01', '{"bands": [{"from_annual_ch": 0, "rate_bp": 0}, {"from_annual_ch": 30000000, "rate_bp": 1000}, {"from_annual_ch": 40000000, "rate_bp": 1500}, {"from_annual_ch": 65000000, "rate_bp": 2000}, {"from_annual_ch": 100000000, "rate_bp": 2500}, {"from_annual_ch": 150000000, "rate_bp": 3000}], "months_per_year": 12, "taxable_round_up_to_ch": 10000, "result_round_to_ch": 100, "result_rounding": "nearest"}'::jsonb, 'DRC Annexure III, revised TDS schedule for monthly salary income'),
  ('health_contribution', 'intern', '2026-01-01', '{"enabled": true, "rate_bp": 100, "round_to_ch": 100, "rounding": "nearest"}'::jsonb, 'Health contribution, 1% of gross. Rounding to confirm with the accountant'),
  ('provident_fund', 'intern', '2026-01-01', '{"enabled": false}'::jsonb, 'Off until NPPF registration (2027)'),
  ('gis', 'intern', '2026-01-01', '{"amount_ch": 0}'::jsonb, 'Not applicable to Xceed'),
  ('proration', 'intern', '2026-01-01', '{"basis": "calendar_days", "round_to_ch": 100, "rounding": "nearest"}'::jsonb, 'Calendar days, basic + allowances or stipend'),
  ('it1a_inclusion', 'intern', '2026-01-01', '{"include": true}'::jsonb, 'Include interns on IT-1(a). To confirm with the accountant');
