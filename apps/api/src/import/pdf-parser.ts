import type { ParsedRow } from '@pfm/core';

type PdfParseFn = (
  buffer: Buffer,
  options?: { max?: number },
) => Promise<{ text: string; numpages: number; info: unknown; metadata: unknown }>;

// pdf-parse v1 exports the function directly as module.exports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: PdfParseFn = require('pdf-parse');

// Patterns that identify the start of a transaction line.
// Ordered from most to least specific.
const DATE_AT_START: RegExp[] = [
  /^(\d{4}-\d{2}-\d{2})/,                              // 2024-06-03
  /^(\d{1,2}\/\d{1,2}\/\d{2,4})/,                      // 06/03/2024 or 6/3/24
  /^(\d{1,2}-\d{1,2}-\d{2,4})/,                        // 06-03-2024
  /^([A-Z][a-z]{2}\.?\s+\d{1,2},?\s*\d{4})/,          // Jun 3, 2024 / Jun. 3 2024
  /^([A-Z][a-z]{2}\.?\s+\d{1,2}(?!\d))/,              // Jun 3  (no year — common in statements)
];

// A monetary amount: optional sign/symbol, digits with optional commas, required decimal
const AMOUNT_RE = /(-?\$?[\d,]+\.\d{2})/g;

function normalizeDate(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (mdy) {
    const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    return `${year}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  // "Jun 3, 2024" / "Jun 3 2024"
  const mon = s.match(/^([A-Z][a-z]{2})\.?\s+(\d{1,2}),?\s*(\d{4})/);
  if (mon) {
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const m = months[mon[1]];
    if (m) return `${mon[3]}-${m}-${mon[2].padStart(2, '0')}`;
  }

  // "Jun 3" (no year — use a placeholder; the caller can post-process)
  const monNoYear = s.match(/^([A-Z][a-z]{2})\.?\s+(\d{1,2})(?!\d)/);
  if (monNoYear) {
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const m = months[monNoYear[1]];
    const year = new Date().getFullYear();
    if (m) return `${year}-${m}-${monNoYear[2].padStart(2, '0')}`;
  }

  return s.slice(0, 10);
}

function parseAmount(raw: string): number {
  const s = raw.replace(/[$,\s]/g, '');
  const val = parseFloat(s);
  return isNaN(val) ? 0 : Math.round(val * 100);
}

export type PdfParseResult = { rows: ParsedRow[]; rowCount: number; pageCount: number };

export async function parsePdf(buffer: Buffer): Promise<PdfParseResult> {
  const data = await pdfParse(buffer);
  const lines = data.text
    .split('\n')
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0);

  const rows: ParsedRow[] = [];

  for (const line of lines) {
    // Try each date pattern against the start of the line
    let dateRaw: string | null = null;
    let dateMatchLen = 0;

    for (const pattern of DATE_AT_START) {
      const m = pattern.exec(line);
      if (m) {
        dateRaw = m[1];
        dateMatchLen = m[0].length;
        break;
      }
    }

    if (!dateRaw) continue;

    // Collect all monetary amounts on the line
    const rest = line.slice(dateMatchLen).trim();
    const amounts: string[] = [];
    let am: RegExpExecArray | null;
    const amRe = new RegExp(AMOUNT_RE.source, 'g');
    while ((am = amRe.exec(rest)) !== null) amounts.push(am[1]);

    if (amounts.length === 0) continue;

    // Use the last amount found — usually the transaction amount, not a running balance
    // (running balance typically appears after the transaction amount)
    const lastAmount = amounts[amounts.length - 1];
    const amountMinor = parseAmount(lastAmount);

    // Everything before the last amount is the merchant/description
    const amountIdx = rest.lastIndexOf(lastAmount);
    const merchant = rest.slice(0, amountIdx).trim().replace(/\s{2,}/g, ' ') || null;

    rows.push({
      date: normalizeDate(dateRaw),
      merchant: merchant || null,
      amountMinor,
    });
  }

  return { rows, rowCount: rows.length, pageCount: data.numpages };
}
