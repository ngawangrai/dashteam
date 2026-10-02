import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField, lastFour, parseFieldKey } from "./field";

const key = randomBytes(32);
const sonam = { personId: "33333333-3333-4333-8333-333333333333", field: "tpn" as const };
const TPN = "ABC1234567";

describe("field encryption", () => {
  it("round-trips a value", () => {
    expect(decryptField(encryptField(TPN, sonam, key), sonam, key)).toBe(TPN);
  });

  it("never stores the value in the clear", () => {
    const stored = encryptField(TPN, sonam, key);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain(TPN);
    expect(Buffer.from(stored.slice(3), "base64").toString("latin1")).not.toContain(TPN);
  });

  it("gives a different ciphertext every time", () => {
    expect(encryptField(TPN, sonam, key)).not.toBe(encryptField(TPN, sonam, key));
  });

  it("refuses a ciphertext that was tampered with", () => {
    const stored = encryptField(TPN, sonam, key);
    const bytes = Buffer.from(stored.slice(3), "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(() => decryptField(`v1:${bytes.toString("base64")}`, sonam, key)).toThrow();
  });

  it("refuses the wrong key", () => {
    expect(() => decryptField(encryptField(TPN, sonam, key), sonam, randomBytes(32))).toThrow();
  });

  it("refuses a value moved to another person", () => {
    const stored = encryptField(TPN, sonam, key);
    expect(() => decryptField(stored, { ...sonam, personId: "44444444-4444-4444-8444-444444444444" }, key)).toThrow();
  });

  it("refuses a value moved to another field", () => {
    const stored = encryptField(TPN, sonam, key);
    expect(() => decryptField(stored, { ...sonam, field: "bank_account" }, key)).toThrow();
  });

  it("refuses an unknown format", () => {
    expect(() => decryptField("v9:abc", sonam, key)).toThrow();
  });

  it("never puts the value or ciphertext in an error message", () => {
    const stored = encryptField(TPN, sonam, key);
    try {
      decryptField(stored, sonam, randomBytes(32));
      expect.unreachable();
    } catch (error) {
      const message = String(error instanceof Error ? `${error.message} ${error.stack}` : error);
      expect(message).not.toContain(TPN);
      expect(message).not.toContain(stored.slice(3, 20));
    }
  });
});

describe("field key", () => {
  it("accepts 32 bytes in base64", () => {
    expect(parseFieldKey(key.toString("base64"))).toHaveLength(32);
  });

  it.each([undefined, "", "short", randomBytes(16).toString("base64"), randomBytes(64).toString("base64")])(
    "refuses %j",
    (value) => {
      expect(() => parseFieldKey(value)).toThrow(/FIELD_ENCRYPTION_KEY/);
    },
  );
});

describe("lastFour", () => {
  it("keeps the last four characters", () => {
    expect(lastFour("1234567890")).toBe("7890");
    expect(lastFour("ab")).toBe("ab");
  });
});
