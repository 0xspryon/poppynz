/**
 * A minimal text-only PDF (Tier 3 step 4): Stripe accepts dispute evidence
 * documents as PDF, JPEG or PNG only (verified in test mode — text/plain is
 * refused), so the evidence pack is rendered as a plain PDF: Helvetica,
 * WinAnsi encoding (English and French accents), wrapped lines, A4 portrait.
 *
 * Deliberately small and dependency-free. Characters outside WinAnsi become
 * "?". The page count is capped (card networks cap evidence documents; the
 * whole pack must stay well under Stripe's limits), with a closing line
 * saying the rest was left out.
 */

export type PdfSection = { heading: string; lines: ReadonlyArray<string> };

export const EVIDENCE_PDF_MAX_PAGES = 30;

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 9.5;
const LEADING = 13;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING);
const WRAP_AT = 100;

/** Unicode → WinAnsi (cp1252) for the characters that differ from Latin-1. */
const winAnsiExtras: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  œ: 0x9c,
  Œ: 0x8c
};

const toWinAnsi = (text: string): Array<number> => {
  const bytes: Array<number> = [];
  for (const char of text) {
    const extra = winAnsiExtras[char];
    if (extra !== undefined) {
      bytes.push(extra);
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code === 0x09) bytes.push(0x20);
    else if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else bytes.push(0x3f);
  }
  return bytes;
};

/** A PDF string literal: ( ) and \ escaped, non-ASCII as octal. */
const pdfString = (text: string) =>
  '(' +
  toWinAnsi(text)
    .map((byte) =>
      byte === 0x28 || byte === 0x29 || byte === 0x5c
        ? `\\${String.fromCharCode(byte)}`
        : byte < 0x80
          ? String.fromCharCode(byte)
          : `\\${byte.toString(8).padStart(3, '0')}`
    )
    .join('') +
  ')';

/** Wraps one paragraph at word boundaries (long words are cut). */
export const wrapLine = (text: string, width = WRAP_AT): Array<string> => {
  const out: Array<string> = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      let rest = word;
      while (rest.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (line.length === 0) line = rest;
      else if (line.length + 1 + rest.length <= width) line = `${line} ${rest}`;
      else {
        out.push(line);
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
};

type Line = { text: string; bold: boolean };

/** Lays the sections out in lines, then pages (capped). */
export const layoutPages = (
  title: string,
  sections: ReadonlyArray<PdfSection>,
  maxPages = EVIDENCE_PDF_MAX_PAGES
): Array<Array<Line>> => {
  const lines: Array<Line> = [
    { text: title, bold: true },
    { text: '', bold: false }
  ];
  for (const section of sections) {
    lines.push({ text: section.heading, bold: true });
    for (const raw of section.lines) {
      for (const text of wrapLine(raw)) lines.push({ text, bold: false });
    }
    lines.push({ text: '', bold: false });
  }
  const pages: Array<Array<Line>> = [];
  for (let at = 0; at < lines.length; at += LINES_PER_PAGE) {
    pages.push(lines.slice(at, at + LINES_PER_PAGE));
  }
  if (pages.length > maxPages) {
    const kept = pages.slice(0, maxPages);
    const last = kept[maxPages - 1]!;
    last[last.length - 1] = {
      text: `[… ${pages.length - maxPages} more page(s) left out to stay within the evidence limits]`,
      bold: true
    };
    return kept;
  }
  return pages;
};

/** Renders the sections as a PDF document's bytes. */
export const renderTextPdf = (
  title: string,
  sections: ReadonlyArray<PdfSection>,
  maxPages = EVIDENCE_PDF_MAX_PAGES
): Uint8Array => {
  const pages = layoutPages(title, sections, maxPages);
  // Objects: 1 catalog, 2 pages, 3 regular font, 4 bold font, then a page
  // and its content stream per page.
  const objects: Array<string> = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, index) => {
    const pageId = pageIds[index]!;
    const body = [
      'BT',
      `${LEADING} TL`,
      `${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`,
      ...lines.map(
        (line) => `/${line.bold ? 'F2' : 'F1'} ${FONT_SIZE} Tf ${pdfString(line.text)} Tj T*`
      ),
      `/F1 8 Tf ${pdfString(`Page ${index + 1} of ${pages.length}`)} Tj`,
      'ET'
    ].join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  // Every character above is ASCII (strings were escaped to octal), so the
  // string length is the byte length.
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: Array<number> = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let index = 0; index < out.length; index++) bytes[index] = out.charCodeAt(index) & 0xff;
  return bytes;
};
