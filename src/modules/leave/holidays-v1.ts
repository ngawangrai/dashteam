import type { Holiday } from "./holidays";

// Bhutan's government holidays for 2026 and 2027, as researched on 3 October 2026.
// supabase/migrations/*_v1_holidays.sql inserts exactly these; tests/db/holidays.test.ts checks they match.
//
// 2026: confirmed against the Ministry of Home Affairs' official list (notification dated 25 November 2025).
// 2027: tentative. The official list wasn't published yet; dates come from secondary sources.

const MOHA_2026 = "https://www.moha.gov.bt/wp-content/uploads/2025/11/calender-2026.pdf";
const SECONDARY_2027 =
  "https://www.officeholidays.com/countries/bhutan/2027 (cross-checked with https://www.calendarlabs.com/holidays/bhutan/2027)";
const NOT_PUBLISHED = "Official 2027 list not published yet.";

type Row = Omit<Holiday, "year" | "source" | "status" | "note"> & { note?: string };

const confirmed2026: Row[] = [
  { name: "Winter Solstice (Nyilo)", startDate: "2026-01-02", endDate: "2026-01-02", kind: "fixed", scope: "national" },
  {
    name: "Traditional Day of Offering",
    startDate: "2026-01-19",
    endDate: "2026-01-19",
    kind: "lunar",
    scope: "national",
    note: "The official list gives 19 January; one secondary list says 18 January.",
  },
  { name: "Losar", startDate: "2026-02-18", endDate: "2026-02-19", kind: "lunar", scope: "national" },
  { name: "Birth Anniversary of His Majesty the King", startDate: "2026-02-21", endDate: "2026-02-23", kind: "fixed", scope: "national" },
  { name: "Death Anniversary of Zhabdrung", startDate: "2026-04-26", endDate: "2026-04-26", kind: "lunar", scope: "national" },
  { name: "Birth Anniversary of the Third Druk Gyalpo", startDate: "2026-05-02", endDate: "2026-05-02", kind: "fixed", scope: "national" },
  { name: "Lord Buddha’s Parinirvana", startDate: "2026-05-31", endDate: "2026-05-31", kind: "lunar", scope: "national" },
  { name: "Birth Anniversary of Guru Rinpoche", startDate: "2026-06-24", endDate: "2026-06-24", kind: "lunar", scope: "national" },
  { name: "First Sermon of Lord Buddha", startDate: "2026-07-18", endDate: "2026-07-18", kind: "lunar", scope: "national" },
  { name: "Thimphu Drubchen", startDate: "2026-09-17", endDate: "2026-09-17", kind: "lunar", scope: "thimphu" },
  { name: "Thimphu Tshechu", startDate: "2026-09-21", endDate: "2026-09-23", kind: "lunar", scope: "thimphu" },
  { name: "Blessed Rainy Day", startDate: "2026-09-23", endDate: "2026-09-23", kind: "lunar", scope: "national" },
  { name: "Dashain", startDate: "2026-10-21", endDate: "2026-10-21", kind: "lunar", scope: "national" },
  { name: "Descending Day of Lord Buddha", startDate: "2026-11-01", endDate: "2026-11-01", kind: "lunar", scope: "national" },
  { name: "Coronation of His Majesty the King", startDate: "2026-11-01", endDate: "2026-11-01", kind: "fixed", scope: "national" },
  { name: "Birth Anniversary of the Fourth Druk Gyalpo", startDate: "2026-11-11", endDate: "2026-11-11", kind: "fixed", scope: "national" },
  { name: "National Day", startDate: "2026-12-17", endDate: "2026-12-17", kind: "fixed", scope: "national" },
];

const tentative2027: Row[] = [
  { name: "Winter Solstice (Nyilo)", startDate: "2027-01-02", endDate: "2027-01-02", kind: "fixed", scope: "national" },
  { name: "Traditional Day of Offering", startDate: "2027-01-08", endDate: "2027-01-08", kind: "lunar", scope: "national" },
  { name: "Losar", startDate: "2027-02-07", endDate: "2027-02-08", kind: "lunar", scope: "national" },
  { name: "Birth Anniversary of His Majesty the King", startDate: "2027-02-21", endDate: "2027-02-23", kind: "fixed", scope: "national" },
  { name: "Death Anniversary of Zhabdrung", startDate: "2027-04-16", endDate: "2027-04-16", kind: "lunar", scope: "national" },
  { name: "Birth Anniversary of the Third Druk Gyalpo", startDate: "2027-05-02", endDate: "2027-05-02", kind: "fixed", scope: "national" },
  { name: "Lord Buddha’s Parinirvana", startDate: "2027-05-20", endDate: "2027-05-20", kind: "lunar", scope: "national" },
  { name: "Birth Anniversary of Guru Rinpoche", startDate: "2027-06-13", endDate: "2027-06-13", kind: "lunar", scope: "national" },
  { name: "First Sermon of Lord Buddha", startDate: "2027-08-06", endDate: "2027-08-06", kind: "lunar", scope: "national" },
  { name: "Blessed Rainy Day", startDate: "2027-09-23", endDate: "2027-09-23", kind: "lunar", scope: "national" },
  { name: "Thimphu Drubchen", startDate: "2027-10-06", endDate: "2027-10-06", kind: "lunar", scope: "thimphu" },
  {
    name: "Dashain",
    startDate: "2027-10-09",
    endDate: "2027-10-09",
    kind: "lunar",
    scope: "national",
    note: "Sources disagree: OfficeHolidays gives 9 October; CalendarLabs lists it with Thimphu Tshechu, 10 to 12 October.",
  },
  { name: "Thimphu Tshechu", startDate: "2027-10-10", endDate: "2027-10-12", kind: "lunar", scope: "thimphu" },
  { name: "Coronation of His Majesty the King", startDate: "2027-11-01", endDate: "2027-11-01", kind: "fixed", scope: "national" },
  { name: "Birth Anniversary of the Fourth Druk Gyalpo", startDate: "2027-11-11", endDate: "2027-11-11", kind: "fixed", scope: "national" },
  { name: "Descending Day of Lord Buddha", startDate: "2027-11-20", endDate: "2027-11-20", kind: "lunar", scope: "national" },
  { name: "National Day", startDate: "2027-12-17", endDate: "2027-12-17", kind: "fixed", scope: "national" },
];

export const V1_HOLIDAYS: Holiday[] = [
  ...confirmed2026.map((row) => ({ ...row, year: 2026, status: "confirmed" as const, source: MOHA_2026, note: row.note ?? "" })),
  ...tentative2027.map((row) => ({
    ...row,
    year: 2027,
    status: "tentative" as const,
    source: SECONDARY_2027,
    note: row.note ? `${NOT_PUBLISHED} ${row.note}` : NOT_PUBLISHED,
  })),
];
