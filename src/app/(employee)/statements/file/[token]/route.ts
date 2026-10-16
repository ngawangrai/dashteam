import { getSessionUser } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env/server";
import { linkKeyFrom, verifyDocumentLink } from "@/modules/documents/link";
import { pdfResponse } from "@/modules/documents/pdf-response";
import { statementFile } from "@/modules/documents/statements";

// Serves a stored pay statement through a short-lived link, the same way as a payslip: the link must
// be valid and issued to whoever is signed in, and RLS must still let them read it.

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const refused = () => Response.redirect(new URL("/payslips/unavailable", request.url), 303);
  const user = await getSessionUser();
  if (!user || user.access !== "ok") return refused();
  const link = verifyDocumentLink(decodeURIComponent((await params).token), { kind: "statement", userId: user.id }, linkKeyFrom(Buffer.from(serverEnv.FIELD_ENCRYPTION_KEY, "base64")));
  if (!link) return refused();
  const file = await statementFile(user, link.id);
  return file ? pdfResponse(file.pdf, file.filename) : refused();
}
