import { getSessionUser } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env/server";
import { certificateFile } from "@/modules/documents/certificates";
import { linkKeyFrom, verifyDocumentLink } from "@/modules/documents/link";
import { pdfResponse } from "@/modules/documents/pdf-response";

// Serves an issued salary certificate through a short-lived link, checked like a payslip's.

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const refused = () => Response.redirect(new URL("/payslips/unavailable", request.url), 303);
  const user = await getSessionUser();
  if (!user || user.access !== "ok") return refused();
  const link = verifyDocumentLink(decodeURIComponent((await params).token), { kind: "certificate", userId: user.id }, linkKeyFrom(Buffer.from(serverEnv.FIELD_ENCRYPTION_KEY, "base64")));
  if (!link) return refused();
  const file = await certificateFile(user, link.id);
  return file ? pdfResponse(file.pdf, file.filename) : refused();
}
