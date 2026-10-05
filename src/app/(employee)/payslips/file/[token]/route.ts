import { eq, sql } from "drizzle-orm";
import { getSessionUser, claimsFor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { payslips } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env/server";
import { linkKeyFrom, verifyPayslipLink } from "@/modules/documents/link";
import type { PayslipModel } from "@/modules/documents/model";

// Serves a stored payslip PDF through a short-lived link. The link must be valid, unexpired and
// issued to the person now signed in, and RLS must still let them read the payslip. Every refusal
// looks the same, so a link reveals nothing about payslips that aren't yours.

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const refused = () => Response.redirect(new URL("/payslips/unavailable", request.url), 303);
  const user = await getSessionUser();
  if (!user || user.access !== "ok") return refused();

  const { token } = await params;
  const link = verifyPayslipLink(decodeURIComponent(token), { userId: user.id }, linkKeyFrom(Buffer.from(serverEnv.FIELD_ENCRYPTION_KEY, "base64")));
  if (!link) return refused();

  const slip = await asUser(claimsFor(user), async (tx) => {
    const [row] = await tx.select({ pdf: payslips.pdf, content: payslips.content }).from(payslips).where(eq(payslips.id, link.payslipId)).limit(1);
    if (row && user.role === "admin") await tx.execute(sql`select public.record_payslip_download(${link.payslipId})`);
    return row ?? null;
  });
  if (!slip) return refused();

  const model = slip.content as PayslipModel;
  const name = user.role === "admin" ? `Payslip ${model.monthName}, ${model.person.name}.pdf` : `Payslip ${model.monthName}.pdf`;
  return new Response(new Uint8Array(slip.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Pay figures: never kept by a browser or proxy cache.
      "Cache-Control": "no-store",
    },
  });
}
