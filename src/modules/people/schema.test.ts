import { describe, expect, it } from "vitest";
import { changeRequestSchema, exitSchema, newPersonSchema, payChangeSchema, personDetailsSchema } from "./schema";

const details = {
  fullName: "Sonam Wangmo",
  email: "Sonam@Xceed.Studio ",
  phone: "17 11 22 33",
  bankName: "Bank of Bhutan",
  bankAccount: "1000 2000 3000",
  tpn: "abc12345",
  startDate: "2026-10-15",
};

describe("person details", () => {
  it("tidies what people type", () => {
    expect(personDetailsSchema.parse(details)).toEqual({
      fullName: "Sonam Wangmo",
      email: "sonam@xceed.studio",
      phone: "17112233",
      bankName: "Bank of Bhutan",
      bankAccount: "100020003000",
      tpn: "ABC12345",
      startDate: "2026-10-15",
    });
  });

  it("lets phone, bank and TPN be left empty", () => {
    expect(personDetailsSchema.parse({ ...details, phone: "", bankName: "", bankAccount: "", tpn: "" })).toMatchObject({
      phone: null,
      bankName: null,
      bankAccount: null,
      tpn: null,
    });
  });

  it.each([
    ["no name", { fullName: " " }],
    ["a bad email", { email: "sonam" }],
    ["a short phone number", { phone: "1711" }],
    ["a bank that isn't in the list", { bankName: "Some Bank" }],
    ["letters in an account number", { bankAccount: "12AB3456" }],
    ["a short account number", { bankAccount: "12345" }],
    ["a TPN with symbols", { tpn: "AB-12345" }],
    ["an account number without a bank", { bankName: "" }],
    ["a date that does not exist", { startDate: "2026-02-30" }],
  ])("refuses %s", (_label, change) => {
    expect(personDetailsSchema.safeParse({ ...details, ...change }).success).toBe(false);
  });
});

describe("new person", () => {
  it("takes basic and allowances for full-time staff", () => {
    const parsed = newPersonSchema.parse({ ...details, employmentType: "full_time", basic: "40,000", allowances: "5,000" });
    expect(parsed.pay).toEqual({ employmentType: "full_time", basic: 4_000_000, allowances: 500_000 });
  });

  it("treats empty allowances as none", () => {
    expect(newPersonSchema.parse({ ...details, employmentType: "full_time", basic: "40000", allowances: "" }).pay).toEqual({
      employmentType: "full_time",
      basic: 4_000_000,
      allowances: 0,
    });
  });

  it("takes a stipend for interns", () => {
    const parsed = newPersonSchema.parse({ ...details, employmentType: "intern", stipend: "20,000" });
    expect(parsed.pay).toEqual({ employmentType: "intern", stipend: 2_000_000 });
  });

  it("needs the pay for the type", () => {
    expect(newPersonSchema.safeParse({ ...details, employmentType: "intern", basic: "40000" }).success).toBe(false);
    expect(newPersonSchema.safeParse({ ...details, employmentType: "full_time", stipend: "20000" }).success).toBe(false);
  });
});

describe("pay change", () => {
  it("starts on the first of a month", () => {
    expect(payChangeSchema.parse({ effectiveFrom: "2026-11-01", employmentType: "full_time", basic: "44000", allowances: "5000" })).toEqual({
      effectiveFrom: "2026-11-01",
      pay: { employmentType: "full_time", basic: 4_400_000, allowances: 500_000 },
    });
    expect(payChangeSchema.safeParse({ effectiveFrom: "2026-11-15", employmentType: "intern", stipend: "1" }).success).toBe(false);
  });
});

describe("leaving", () => {
  it("needs a last working day on or after the start date", () => {
    expect(exitSchema("2026-01-05").safeParse({ endDate: "2026-01-04" }).success).toBe(false);
    expect(exitSchema("2026-01-05").safeParse({ endDate: "2026-01-05" }).success).toBe(true);
  });
});

describe("change request", () => {
  const current = { phone: "17112233", bankName: "Bank of Bhutan" };

  it("keeps only what changed", () => {
    expect(changeRequestSchema(current).parse({ phone: "17 44 55 66", bankName: "Bank of Bhutan", bankAccount: "" })).toEqual({
      phone: "17445566",
      bankName: null,
      bankAccount: null,
    });
  });

  it("needs an account number when the bank changes", () => {
    expect(changeRequestSchema(current).safeParse({ phone: "17112233", bankName: "T Bank", bankAccount: "" }).success).toBe(false);
  });

  it("refuses a request that changes nothing", () => {
    expect(changeRequestSchema(current).safeParse({ phone: "17112233", bankName: "Bank of Bhutan", bankAccount: "" }).success).toBe(
      false,
    );
  });
});
