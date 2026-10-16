import { describe, expect, it } from "vitest";
import { monthOf } from "@/lib/format";
import { payInForce } from "@/modules/people/pay";
import { resolveCompanyDetails } from "@/modules/rules/resolve";
import { OCTOBER, RULES, nu, salary, stipend } from "../../../tests/support/mixed-team";
import { certificateModel, certificateReference, payStatement, purposePhrase, type CertificateInput } from "./certificate-model";

// The certificate states the pay in force on the day it's issued, in a letter a bank can rely on.

const COMPANY = resolveCompanyDetails(RULES, OCTOBER);
const SONAM_PAY = [salary(40_000, 5_000, "2025-03-01"), salary(50_000, 6_000, "2026-11-01")];

/** The letter keeps dates and amounts on one line with no-break spaces; compare as plain text. */
const plain = (text: string) => text.replace(/\u00a0/g, " ");

const letter = (fields: Partial<CertificateInput> = {}) =>
  certificateModel({
    person: { name: "Sonam Wangmo", jobTitle: "Product Designer", startDate: "2025-03-03" },
    terms: SONAM_PAY[0] ?? salary(0, 0),
    addressee: "",
    purpose: "",
    signatory: { name: "Tashi Dorji", title: "Founder" },
    company: COMPANY,
    reference: "XS-SC-2026-004",
    issuedOn: "2026-10-07",
    ...fields,
  });

describe("the pay it states", () => {
  it("is the pay record in force on the issue date, not a raise that starts later", () => {
    const october = payInForce(SONAM_PAY, monthOf("2026-10-07"));
    const november = payInForce(SONAM_PAY, monthOf("2026-11-02"));
    expect(letter({ terms: october ?? salary(0, 0) }).monthlyPay).toBe(nu(45_000));
    expect(letter({ terms: november ?? salary(0, 0), issuedOn: "2026-11-02" }).monthlyPay).toBe(nu(56_000));
  });

  it("gives the monthly salary and its parts, or the stipend for an intern", () => {
    expect(plain(payStatement("Sonam Wangmo", salary(40_000, 5_000)))).toBe("Sonam Wangmo’s current monthly salary is Nu. 45,000: basic pay of Nu. 40,000 and allowances of Nu. 5,000.");
    expect(plain(payStatement("Karma Wangchuk", salary(40_000, 0)))).toBe("Karma Wangchuk’s current monthly salary is Nu. 40,000.");
    expect(plain(payStatement("Dechen Lhamo", stipend(20_000)))).toBe("Dechen Lhamo’s current monthly stipend is Nu. 20,000.");
  });
});

describe("the letter", () => {
  it("reads as a company letter for a full-time employee", () => {
    const model = letter({ addressee: "The Manager\nBank of Bhutan, Thimphu", purpose: "a home loan application" });
    expect(model.addressee).toEqual(["The Manager", "Bank of Bhutan, Thimphu"]);
    expect(model.subject).toBe("Salary certificate");
    expect(model.paragraphs.map(plain)).toEqual([
      "This is to certify that Sonam Wangmo has been employed full-time with Xceed Studio since 3 March 2025. Sonam Wangmo’s current designation is Product Designer.",
      "Sonam Wangmo’s current monthly salary is Nu. 45,000: basic pay of Nu. 40,000 and allowances of Nu. 5,000.",
      "This certificate is issued at Sonam Wangmo’s request for a home loan application.",
    ]);
    expect(model.signOff).toBe("For Xceed Studio");
    expect(model.signatory).toEqual({ name: "Tashi Dorji", title: "Founder" });
    expect(model.issuedOn).toBe("7 October 2026");
    expect(model.reference).toBe("XS-SC-2026-004");
  });

  it("is addressed to whom it may concern when nobody is named, and needs no purpose", () => {
    const model = letter();
    expect(model.addressee).toEqual(["To whom it may concern"]);
    expect(model.paragraphs[2]).toBe("This certificate is issued at the request of Sonam Wangmo.");
  });

  it("has its own wording for an intern", () => {
    const model = letter({ person: { name: "Dechen Lhamo", jobTitle: "Design Intern", startDate: "2026-06-01" }, terms: stipend(20_000) });
    expect(model.paragraphs.slice(0, 2).map(plain)).toEqual([
      "This is to certify that Dechen Lhamo has been an intern with Xceed Studio since 1 June 2026. Dechen Lhamo’s current designation is Design Intern.",
      "Dechen Lhamo’s current monthly stipend is Nu. 20,000.",
    ]);
  });

  it("reads a purpose however it was typed", () => {
    expect(purposePhrase("For a home loan.")).toBe("a home loan");
    expect(purposePhrase("  a visa application  ")).toBe("a visa application");
  });

  it("keeps dates and amounts whole", () => {
    expect(letter().paragraphs[0]).toContain("3\u00a0March\u00a02025");
    expect(letter().paragraphs[1]).toContain("Nu.\u00a045,000");
  });

  it("never uses an em dash", () => {
    const model = letter({ purpose: "a car loan" });
    expect([...model.paragraphs, ...model.addressee].join(" ")).not.toContain("—");
  });
});

it("references count up within the year", () => {
  expect(certificateReference(2026, 4)).toBe("XS-SC-2026-004");
});
