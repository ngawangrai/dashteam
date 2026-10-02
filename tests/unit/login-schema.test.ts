import { describe, expect, it } from "vitest";
import { sendCodeErrorMessage, verifyCodeErrorMessage } from "@/app/login/messages";
import { codeSchema, emailSchema } from "@/app/login/schema";

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    expect(emailSchema.parse("  Sonam@Xceed.Studio ")).toBe("sonam@xceed.studio");
  });

  it("rejects something that is not an email", () => {
    expect(emailSchema.safeParse("sonam").success).toBe(false);
  });
});

describe("codeSchema", () => {
  it("accepts six digits, ignoring spaces from a pasted code", () => {
    expect(codeSchema.parse("123 456")).toBe("123456");
  });

  it.each(["12345", "1234567", "12345a", ""])("rejects %j", (code) => {
    expect(codeSchema.safeParse(code).success).toBe(false);
  });
});

describe("login messages", () => {
  const all = [
    sendCodeErrorMessage("signup_disabled"),
    sendCodeErrorMessage("otp_disabled"),
    sendCodeErrorMessage("over_email_send_rate_limit"),
    sendCodeErrorMessage(undefined),
    verifyCodeErrorMessage("otp_expired"),
    verifyCodeErrorMessage("over_request_rate_limit"),
    verifyCodeErrorMessage(undefined),
  ];

  it("tells an unknown email to ask their admin", () => {
    expect(sendCodeErrorMessage("otp_disabled")).toMatch(/ask your admin/i);
  });

  it.each(all)("follows the writing rules: %s", (message) => {
    expect(message).not.toMatch(/[—!]/);
    expect(message).not.toMatch(/error|invalid|failed|\b\d{3}\b/i);
  });
});
