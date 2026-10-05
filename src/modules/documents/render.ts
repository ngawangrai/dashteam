import { createHash } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import type { PayslipModel } from "./model";
import { PayslipDocument } from "./payslip-document";

/** The payslip as PDF bytes, with a SHA-256 so its identity can be checked later. */
export async function renderPayslip(model: PayslipModel): Promise<{ pdf: Buffer; sha256: string }> {
  // Called as a function so react-pdf receives the <Document> element itself.
  const pdf = await renderToBuffer(PayslipDocument({ model }));
  return { pdf, sha256: createHash("sha256").update(pdf).digest("hex") };
}
