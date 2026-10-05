import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { linkKeyFrom, signPayslipLink, verifyPayslipLink } from "./link";

// A payslip file is reachable only through a short-lived link, issued after a permission check,
// that works for the person it was issued to and nobody else.

const key = linkKeyFrom(randomBytes(32));
const PAYSLIP = "5c1a0d9e-1111-4111-8111-000000000001";
const SONAM = "22222222-2222-4222-8222-222222222222";
const PEMA = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-10-31T10:00:00Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe("payslip links", () => {
  const token = signPayslipLink({ payslipId: PAYSLIP, userId: SONAM, now }, key);

  it("open for the person they were issued to, within a minute", () => {
    expect(verifyPayslipLink(token, { userId: SONAM, now: later(59) }, key)).toEqual({ payslipId: PAYSLIP });
  });

  it("stop working after a minute", () => {
    expect(verifyPayslipLink(token, { userId: SONAM, now: later(61) }, key)).toBeNull();
  });

  it("don't work for anyone else, even signed in", () => {
    expect(verifyPayslipLink(token, { userId: PEMA, now }, key)).toBeNull();
  });

  it("can't be altered to point at another payslip", () => {
    const [body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body ?? "", "base64url").toString()), p: "5c1a0d9e-1111-4111-8111-000000000002" })).toString("base64url");
    expect(verifyPayslipLink(`${forged}.${signature}`, { userId: SONAM, now }, key)).toBeNull();
  });

  it("refuse anything that isn't a link we made", () => {
    for (const junk of ["", "abc", "a.b", `${token}x`, PAYSLIP]) expect(verifyPayslipLink(junk, { userId: SONAM, now }, key)).toBeNull();
    expect(verifyPayslipLink(token, { userId: SONAM, now }, linkKeyFrom(randomBytes(32)))).toBeNull();
  });
});
