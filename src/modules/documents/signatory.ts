import "server-only";
import { eq } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { signatureImages } from "@/lib/db/schema";
import { thisMonth } from "@/modules/people/repository";
import { resolveCertificateSettings } from "@/modules/rules/resolve";
import { loadRuleRows } from "@/modules/rules/repository";

// Who signs salary certificates now, for the settings screen. Admins only. The signature is shown
// back to the admin as an image; it never goes to anyone else's browser.

export type SignatoryView = { name: string; title: string; signature: { id: string; dataUrl: string } | null } | null;

export async function signatoryView(admin: SessionUser): Promise<SignatoryView> {
  const settings = resolveCertificateSettings(await loadRuleRows(claimsFor(admin)), thisMonth());
  if (!settings) return null;
  let signature: { id: string; dataUrl: string } | null = null;
  if (settings.signatureId) {
    const id = settings.signatureId;
    const [image] = await asUser(claimsFor(admin), (tx) => tx.select({ bytes: signatureImages.bytes, contentType: signatureImages.contentType }).from(signatureImages).where(eq(signatureImages.id, id)).limit(1));
    if (image) signature = { id, dataUrl: `data:${image.contentType};base64,${image.bytes.toString("base64")}` };
  }
  return { name: settings.signatoryName, title: settings.signatoryTitle, signature };
}
