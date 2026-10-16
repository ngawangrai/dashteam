import { requireRole } from "@/lib/auth/session";
import { payrollImportTemplate } from "@/modules/import/payroll-csv";

/** The CSV template for bringing in past months: headings and an example row per employment type. */
export async function GET() {
  await requireRole("admin");
  return new Response(payrollImportTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="DashTeam past payroll template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
