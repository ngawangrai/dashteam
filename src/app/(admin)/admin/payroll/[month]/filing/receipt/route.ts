import { eq, sql } from "drizzle-orm";
import { claimsFor, requireRole } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { filingReceipts, filings } from "@/lib/db/schema";
import { monthOf } from "@/lib/format";
import { lockedRunId } from "@/modules/documents/issue";

// The receipt kept with a month's filing. Admins only; each view is recorded.
export async function GET(_request: Request, { params }: { params: Promise<{ month: string }> }) {
  const admin = await requireRole("admin");
  const { month: key } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return new Response("Not found", { status: 404 });
  const runId = await lockedRunId(monthOf(`${key}-01`), admin);
  const receipt = runId
    ? await asUser(claimsFor(admin), async (tx) => {
        const [filing] = await tx.select({ receiptId: filings.receiptId }).from(filings).where(eq(filings.runId, runId)).limit(1);
        if (!filing?.receiptId) return null;
        const [row] = await tx.select().from(filingReceipts).where(eq(filingReceipts.id, filing.receiptId)).limit(1);
        if (row) await tx.execute(sql`select public.record_filing_download('receipt', ${row.id})`);
        return row ?? null;
      })
    : null;
  if (!receipt) return new Response("There’s no receipt for this month.", { status: 404 });
  return new Response(new Uint8Array(receipt.bytes), {
    headers: {
      "Content-Type": receipt.contentType,
      "Content-Disposition": `inline; filename="${receipt.filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
