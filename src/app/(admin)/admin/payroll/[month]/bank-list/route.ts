import { requireRole } from "@/lib/auth/session";
import { monthOf } from "@/lib/format";
import { bankListCsv } from "@/modules/run/bank-list";
import { bankListFor } from "@/modules/run/repository";

// The bank transfer list for a locked month, as a CSV download. Admins only; every download is audited.
export async function GET(_request: Request, { params }: { params: Promise<{ month: string }> }) {
  const admin = await requireRole("admin");
  const { month } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Not found", { status: 404 });

  const rows = await bankListFor(admin, monthOf(`${month}-01`));
  if (!rows) return new Response("This month isn’t locked yet, so there’s no bank list.", { status: 404 });

  return new Response(bankListCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dashteam-bank-list-${month}.csv"`,
      // Account numbers in full: never kept by a browser or proxy cache.
      "Cache-Control": "no-store",
    },
  });
}
