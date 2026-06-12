import type { ParsedRow } from './csv-parser';

// Supports OFX 1.x (SGML flat format) and OFX 2.x (XML wrapped).

function parseOfxDate(raw: string): string {
  // Format: YYYYMMDDHHMMSS[.mmm][TZ] — we only need YYYYMMDD
  const s = raw.trim().replace(/[^0-9].*$/, '');
  if (s.length >= 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return raw.slice(0, 10);
}

function parseOfxAmount(raw: string): number {
  const val = parseFloat(raw.trim().replace(/,/g, '.'));
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

// ── OFX 1.x (SGML) ──────────────────────────────────────────────────────────
// Tags look like <DTPOSTED>20240101  (no closing tag in SGML variant)
function parseSgml(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const stmttrnRegex = /<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|<\/INVTRANLIST>|$)/gi;
  let match: RegExpExecArray | null;

  function getField(block: string, tag: string): string | null {
    const r = new RegExp(`<${tag}>([^<\r\n]*)`, 'i');
    const m = block.match(r);
    return m ? m[1].trim() : null;
  }

  while ((match = stmttrnRegex.exec(text)) !== null) {
    const block = match[1];
    const rawDate = getField(block, 'DTPOSTED') ?? getField(block, 'DTTRADE');
    const rawAmount = getField(block, 'TRNAMT');
    const merchant =
      getField(block, 'NAME') ?? getField(block, 'MEMO') ?? getField(block, 'PAYEE') ?? null;

    if (!rawDate || !rawAmount) continue;
    rows.push({
      date: parseOfxDate(rawDate),
      amountMinor: parseOfxAmount(rawAmount),
      merchant: merchant || null,
    });
  }
  return rows;
}

// ── OFX 2.x (XML) ───────────────────────────────────────────────────────────
function parseXml(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];

  // Naive tag extraction without a full XML parser — robust enough for OFX 2.x
  function getTagValue(xml: string, tag: string): string | null {
    const r = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i');
    const m = xml.match(r);
    return m ? m[1].trim() : null;
  }

  const stmtTrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;

  while ((match = stmtTrnRegex.exec(text)) !== null) {
    const block = match[1];
    const rawDate = getTagValue(block, 'DTPOSTED') ?? getTagValue(block, 'DTTRADE');
    const rawAmount = getTagValue(block, 'TRNAMT');
    const merchant =
      getTagValue(block, 'NAME') ?? getTagValue(block, 'MEMO') ?? getTagValue(block, 'PAYEE') ?? null;

    if (!rawDate || !rawAmount) continue;
    rows.push({
      date: parseOfxDate(rawDate),
      amountMinor: parseOfxAmount(rawAmount),
      merchant: merchant || null,
    });
  }
  return rows;
}

export type OfxParseResult = { rows: ParsedRow[]; rowCount: number };

export function parseOfx(buffer: Buffer): OfxParseResult {
  const text = buffer.toString('utf-8');
  // OFX 2.x has an XML declaration or starts with <?OFX
  const isXml =
    text.trimStart().startsWith('<?xml') || text.trimStart().startsWith('<?OFX');

  const rows = isXml ? parseXml(text) : parseSgml(text);
  return { rows, rowCount: rows.length };
}
