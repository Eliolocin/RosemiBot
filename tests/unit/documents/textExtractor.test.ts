import { describe, expect, it } from "bun:test";
import { extractTextFromBuffer, PdfParseTimeoutError, parsePdfWithDeadline } from "@/utils/documents/textExtractor";

/** Builds a one-page PDF with correct xref offsets, since the repository ships no PDF fixture. */
function onePagePdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

describe("PDF extraction", () => {
  it("parses a PDF off the main thread and returns its text", async () => {
    const text = await extractTextFromBuffer(onePagePdf("Juno reads this page"), "notes.pdf", "application/pdf");

    expect(text).toContain("Juno reads this page");
  });

  it("abandons a parse that outlasts its deadline", async () => {
    const started = performance.now();

    await expect(parsePdfWithDeadline(onePagePdf("slow"), 1)).rejects.toBeInstanceOf(PdfParseTimeoutError);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("rejects malformed input with a parse error rather than a timeout", async () => {
    const result = parsePdfWithDeadline(Buffer.from("%PDF-1.4 not really a pdf"), 10_000);

    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toBeInstanceOf(PdfParseTimeoutError);
  });
});
