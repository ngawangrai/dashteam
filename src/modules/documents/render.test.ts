import { describe, expect, it } from "vitest";
import type { PayslipModel } from "./model";
import { certificateModel } from "./certificate-model";
import { renderCertificate, renderPayslip, renderStatement } from "./render";
import { statementModel } from "./statement-model";

const nu = (amount: number) => amount * 100;

const model: PayslipModel = {
  company: { name: "Xceed Studio", addressLines: [], showLogo: false },
  title: "Payslip · October 2026",
  monthName: "October 2026",
  person: { name: "Karma Wangchuk", employmentType: "Full-time", tpn: "TPN ••••1234" },
  takeHome: nu(55_225),
  earnings: [
    { label: "Basic", amount: nu(50_000) },
    { label: "Allowances", amount: nu(10_000) },
    { label: "Arrear", detail: "September increment", amount: nu(5_000) },
  ],
  gross: nu(65_000),
  deductions: [
    { label: "Health contribution", amount: nu(650) },
    { label: "TDS", amount: nu(6_125) },
    { label: "Advance recovery", detail: "Advance, 1 of 3", amount: nu(3_000) },
  ],
  totalDeductions: nu(9_775),
  reference: "XS-202610-001",
  issuedOn: "31 October 2026",
  contact: "Tashi",
};

describe("the payslip PDF", () => {
  it("is a one-page A4 PDF", async () => {
    const { pdf, sha256 } = await renderPayslip(model);
    const raw = pdf.toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    // A4 is 595.28 × 841.89 points.
    expect(raw).toMatch(/\/MediaBox\s*\[\s*0 0 595\.2\d* 841\.8\d*\s*\]/);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("still fits one page with a busy month of one-offs", async () => {
    const many = { ...model, earnings: [...model.earnings, ...Array.from({ length: 8 }, (_, i) => ({ label: "Bonus", detail: `Line ${i + 1}`, amount: nu(100) }))] };
    const { pdf } = await renderPayslip(many);
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  });
});

const pages = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
const COMPANY = { name: "Xceed Studio", addressLines: ["Norzin Lam, Thimphu"], showLogo: false, ruleIds: [] };

describe("the pay statement PDF", () => {
  const month = (i: number) => ({ year: 2025 + Math.floor((i + 9) / 12), month: ((i + 9) % 12) + 1 });
  const snapshots = Array.from({ length: 12 }, (_, i) => ({ month: month(i), employmentType: "full_time" as const, gross: nu(45_000), takeHome: nu(41_967), imported: i < 4 }));
  const statement = (count: number) =>
    statementModel({
      person: { name: "Sonam Wangmo", tpnLast4: "0012" },
      range: { from: month(0), to: month(count - 1) },
      snapshots: snapshots.slice(0, count),
      company: COMPANY,
      reference: "XS-PS-2026-0001",
      issuedOn: "2026-10-07",
    });

  it("fits twelve months, imported and live, on one A4 page", async () => {
    const { pdf, sha256 } = await renderStatement(statement(12));
    expect(pdf.toString("latin1").startsWith("%PDF-")).toBe(true);
    expect(pages(pdf)).toBe(1);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the salary certificate PDF", () => {
  const letter = certificateModel({
    person: { name: "Sonam Wangmo", jobTitle: "Product Designer", startDate: "2025-03-03" },
    terms: { effectiveFrom: "2025-03-01", employmentType: "full_time", basic: nu(40_000), allowances: nu(5_000) },
    addressee: "The Manager\nBank of Bhutan, Thimphu",
    purpose: "a home loan application",
    signatory: { name: "Tashi Dorji", title: "Founder" },
    company: COMPANY,
    reference: "XS-SC-2026-001",
    issuedOn: "2026-10-07",
  });
  // A 1×1 transparent PNG stands in for a signature.
  const signature = { data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"), format: "png" as const };

  it("is one A4 page, with or without a signature", async () => {
    expect(pages((await renderCertificate(letter, signature)).pdf)).toBe(1);
    expect(pages((await renderCertificate(letter, null)).pdf)).toBe(1);
  });
});

describe("every document lays out the same, whatever was rendered before it", () => {
  // react-pdf keeps parsed fonts between renders; reused fonts once split "of" across two lines in a
  // certificate rendered after a payslip. Each render now loads its own.
  const strip = (pdf: Buffer) => pdf.toString("latin1").replace(/\/CreationDate[^/]*|\/ModDate[^/]*|\/ID \[[^\]]*\]/g, "");
  const letter = certificateModel({
    person: { name: "Sonam Wangmo", jobTitle: "Product Designer", startDate: "2025-03-03" },
    terms: { effectiveFrom: "2025-03-01", employmentType: "full_time", basic: nu(40_000), allowances: nu(5_000) },
    addressee: "",
    purpose: "a home loan application",
    signatory: { name: "Tashi Dorji", title: "Founder" },
    company: COMPANY,
    reference: "XS-SC-2026-001",
    issuedOn: "2026-10-07",
  });

  it("a certificate after a payslip is the certificate on its own", async () => {
    const alone = strip((await renderCertificate(letter, null)).pdf);
    await renderPayslip(model);
    expect(strip((await renderCertificate(letter, null)).pdf)).toBe(alone);
  });

  it("documents rendered at the same time come out whole", async () => {
    const results = await Promise.all([renderPayslip(model), renderCertificate(letter, null), renderPayslip(model)]);
    expect(results.map((result) => pages(result.pdf))).toEqual([1, 1, 1]);
  });
});
