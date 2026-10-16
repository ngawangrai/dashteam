/** A stored PDF, opened in the browser, never cached anywhere: it carries pay figures. */
export function pdfResponse(pdf: Buffer, filename: string): Response {
  const safe = filename.replace(/"/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
