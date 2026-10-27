/** Minimal text-only PDF (A4, Helvetica). Enough for readable financial statements; no dependency. */
export interface PdfLine {
  readonly text: string;
  readonly bold?: boolean;
  readonly size?: number;
  /** Right-aligned amount column text, drawn at the page's right margin. */
  readonly amount?: string;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;
const BOTTOM = 56;

/** ASCII only, so byte offsets equal string offsets; anything else becomes "?". */
function latin1(s: string): string {
  let out = "";
  for (const ch of s.replace(/[\r\n\t]+/g, " ")) {
    const c = ch.codePointAt(0) as number;
    if (ch === "—" || ch === "–") out += "-";
    else if (ch === "’" || ch === "‘") out += "'";
    else if (c >= 32 && c < 127) out += ch;
    else out += "?";
  }
  return out;
}
const esc = (s: string): string => latin1(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function textWidth(s: string, size: number): number {
  return s.length * size * 0.52; // conservative average for Helvetica
}

export function buildPdf(input: { title: string; banner: string; footer: string; lines: readonly PdfLine[] }): Uint8Array {
  const pages: string[][] = [[]];
  let y = PAGE_H - MARGIN - 54;
  const put = (ops: string[], line: PdfLine): void => {
    const size = line.size ?? 10;
    const font = line.bold ? "F2" : "F1";
    // wrap long text to keep every line on the page
    const maxChars = Math.max(10, Math.floor((PAGE_W - 2 * MARGIN - (line.amount ? 110 : 0)) / (size * 0.52)));
    const words = latin1(line.text).split(" ");
    const chunks: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > maxChars) {
        if (cur) chunks.push(cur);
        cur = w;
      } else cur = (cur + " " + w).trim();
    }
    chunks.push(cur);
    chunks.forEach((chunk, i) => {
      if (y < BOTTOM) {
        pages.push([]);
        y = PAGE_H - MARGIN - 54;
        ops = pages[pages.length - 1];
      }
      ops.push(`BT /${font} ${size} Tf ${MARGIN} ${y} Td (${esc(chunk)}) Tj ET`);
      if (line.amount && i === chunks.length - 1) {
        const x = PAGE_W - MARGIN - textWidth(line.amount, size);
        ops.push(`BT /${font} ${size} Tf ${x.toFixed(1)} ${y} Td (${esc(line.amount)}) Tj ET`);
      }
      y -= size + 5;
    });
  };
  for (const line of input.lines) put(pages[pages.length - 1], line);

  const objects: string[] = [];
  const addObj = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const catalog = addObj("");
  const pagesObj = addObj("");
  const f1 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  pages.forEach((ops, idx) => {
    const header = [
      `BT /F2 15 Tf ${MARGIN} ${PAGE_H - MARGIN} Td (${esc(input.title)}) Tj ET`,
      `BT /F2 9 Tf ${MARGIN} ${PAGE_H - MARGIN - 18} Td (${esc(input.banner)}) Tj ET`,
      `0.04 0.12 0.23 RG 1.2 w ${MARGIN} ${PAGE_H - MARGIN - 28} m ${PAGE_W - MARGIN} ${PAGE_H - MARGIN - 28} l S`,
      `BT /F1 8 Tf ${MARGIN} 30 Td (${esc(`${input.footer}  |  Halaman ${idx + 1}/${pages.length}`)}) Tj ET`,
    ];
    const stream = [...header, ...ops].join("\n");
    const content = addObj(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(addObj(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  // Offsets are byte offsets; the document is pure ASCII/Latin-1 so string length equals byte length.
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
