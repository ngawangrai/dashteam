# Fixtures

## drc_tds_table.csv

Source: DRC, Annexure III, "Revised TDS Schedule for Monthly Salary Income" (`TDS-SLAB.pdf` in this folder).

- Columns: `salary_from`, `salary_to`, `tds` (all in ngultrum)
- `salary_from` / `salary_to` = monthly salary after PF and GIS
- 1,319 rows, extracted from the PDF and not edited

### Gaps in the source

The DRC PDF itself skips two ranges. These rows are not in the CSV:

- Nu. 30,201 to 35,500
- Nu. 77,901 to 83,200

The progressive-band calculation covers these ranges. Add a test for one value in each gap,
with the expected TDS confirmed by the accountant before go-live.

### Above the table

For monthly salary above Nu. 1,67,400, DRC's worked example applies:
TDS = 20,208 + 30% × (salary − 1,25,000). Example: Nu. 3,22,500 gives Nu. 79,458.

### Rules

- Never edit this file to make a test pass.
- When DRC revises the schedule, add a new dated file (for example `drc_tds_table_2027-07.csv`)
  and keep this one for testing past months.