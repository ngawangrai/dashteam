import { createHash } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import { CertificateDocument, type SignatureImage } from "./certificate-document";
import type { CertificateModel } from "./certificate-model";
import { freshFonts } from "./letterhead";
import type { PayslipModel } from "./model";
import { PayslipDocument } from "./payslip-document";
import { StatementDocument } from "./statement-document";
import type { StatementModel } from "./statement-model";

// Each document as PDF bytes, with a SHA-256 so its identity can be checked later. The documents are
// called as functions so react-pdf receives the <Document> element itself.

type Rendered = { pdf: Buffer; sha256: string };

// One document at a time, each with fresh fonts (see freshFonts): a render must never share its fonts
// with another one in flight.
let queue: Promise<unknown> = Promise.resolve();

function render(document: Parameters<typeof renderToBuffer>[0]): Promise<Rendered> {
  const next = queue.then(async () => {
    freshFonts();
    const pdf = await renderToBuffer(document);
    return { pdf, sha256: createHash("sha256").update(pdf).digest("hex") };
  });
  queue = next.catch(() => undefined);
  return next;
}

export function renderPayslip(model: PayslipModel): Promise<Rendered> {
  return render(PayslipDocument({ model }));
}

export function renderStatement(model: StatementModel): Promise<Rendered> {
  return render(StatementDocument({ model }));
}

export function renderCertificate(model: CertificateModel, signature: SignatureImage | null): Promise<Rendered> {
  return render(CertificateDocument({ model, signature }));
}
