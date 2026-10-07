import { eq, sql } from "drizzle-orm";
import { claimsFor, requireRole } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { it1aSchedules } from "@/lib/db/schema";
import { formatMonth, monthOf } from "@/lib/format";
import { lockedRunId } from "@/modules/documents/issue";

// The month's IT-1(a) upload file, as stored when it was made. Admins only; each download is recorded.
export async function GET(_request: Request, { params }: { params: Promise<{ month: string }> }) {
  const admin = await requireRole("admin");
  const { month: key } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return new Response("Not found", { status: 404 });
  const month = monthOf(`${key}-01`);
  const runId = await lockedRunId(month, admin);
  const file = runId
    ? await asUser(claimsFor(admin), async (tx) => {
        const [row] = await tx.select({ id: it1aSchedules.id, xls: it1aSchedules.xls }).from(it1aSchedules).where(eq(it1aSchedules.runId, runId)).limit(1);
        if (row) await tx.execute(sql`select public.record_filing_download('schedule', ${row.id})`);
        return row ?? null;
      })
    : null;
  if (!file) return new Response("This month’s IT-1(a) isn’t made yet.", { status: 404 });
  const name = `IT-1(a) ${formatMonth(month, { withYear: true })}.xls`;
  return new Response(new Uint8Array(file.xls), {
    headers: {
      "Content-Type": "application/vnd.ms-excel",
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Full TPNs: never kept by a browser or proxy cache.
      "Cache-Control": "no-store",
    },
  });
}
