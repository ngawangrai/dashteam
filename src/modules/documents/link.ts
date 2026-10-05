import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// Short-lived links to a stored payslip. Issued only after the server has checked, as the signed-in
// person, that they may see it. A link names the payslip, the person it was issued to and when it
// expires, signed so none of that can be changed. No secret of its own: the key is derived from
// FIELD_ENCRYPTION_KEY for this one purpose.

const LINK_SECONDS = 60;

/** A key for signing payslip links, derived from the field encryption key. */
export function linkKeyFrom(fieldKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", fieldKey, Buffer.alloc(0), "dashteam:payslip-link:v1", 32));
}

const sign = (body: string, key: Buffer) => createHmac("sha256", key).update(body).digest("base64url");

export function signPayslipLink({ payslipId, userId, now = new Date() }: { payslipId: string; userId: string; now?: Date }, key: Buffer): string {
  const body = Buffer.from(JSON.stringify({ p: payslipId, u: userId, e: Math.floor(now.getTime() / 1000) + LINK_SECONDS })).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

/** The payslip a link opens, or null if it's expired, altered, someone else's, or not ours at all. */
export function verifyPayslipLink(token: string, { userId, now = new Date() }: { userId: string; now?: Date }, key: Buffer): { payslipId: string } | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as { p?: unknown; u?: unknown; e?: unknown };
    if (typeof claims.p !== "string" || claims.u !== userId || typeof claims.e !== "number") return null;
    if (now.getTime() / 1000 > claims.e) return null;
    return { payslipId: claims.p };
  } catch {
    return null;
  }
}
