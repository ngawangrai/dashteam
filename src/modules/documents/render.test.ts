import { describe, expect, it } from "vitest";
import type { PayslipModel } from "./model";
import { renderPayslip } from "./render";

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
