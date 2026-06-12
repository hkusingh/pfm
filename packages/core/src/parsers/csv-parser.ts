import { createHash } from 'crypto';

export type CsvPreview = {
  format: 'csv';
  columns: string[];
  sampleRows: Record<string, string>[];
  rowCount: number;
  fingerprint: string;
  suggestedMapping: { dateCol: string; merchantCol: string; amountCol: string } | null;
};

// Parse a single CSV line respecting quoted fields and embedded commas.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break; }
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      while (i < line.length && line[i] !== ',') i++;
      if (line[i] === ',') i++;
      fields.push(field.trim());
    } else {
      const start = i;
      while (i < line.length && line[i] !== ',') i++;
      fields.push(line.slice(start, i).trim());
      if (i < line.length) i++;
    }
  }
  return fields;
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function guessMapping(columns: string[]): CsvPreview['suggestedMapping'] {
  const lower = columns.map((c) => c.toLowerCase());

  const dateIdx = lower.findIndex((c) =>
    /date|posted|transaction.?date|trans.?date/.test(c),
  );
  const merchantIdx = lower.findIndex((c) =>
    /desc|description|merchant|name|memo|payee|narration/.test(c),
  );
  const amountIdx = lower.findIndex((c) =>
    /^amount$|^amt$|transaction.?amount|^debit$|^credit$|charge/.test(c),
  );

  if (dateIdx === -1 || amountIdx === -1) return null;
  return {
    dateCol: columns[dateIdx],
    merchantCol: merchantIdx !== -1 ? columns[merchantIdx] : columns.find((_, i) => i !== dateIdx && i !== amountIdx) ?? '',
    amountCol: columns[amountIdx],
  };
}

export function parseCsvPreview(buffer: Buffer, originalName: string): CsvPreview {
  const text = buffer.toString('utf-8');
  const lines = splitLines(text);
  if (lines.length < 1) throw new Error('File appears empty');

  const columns = parseCsvLine(lines[0]);
  const dataLines = lines.slice(1);
  const sampleRows = dataLines.slice(0, 5).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    columns.forEach((col, i) => { row[col] = vals[i] ?? ''; });
    return row;
  });

  const firstDataRow = dataLines[0] ?? '';
  const fingerprint = createHash('sha256')
    .update(`${originalName}|${buffer.length}|${firstDataRow}`)
    .digest('hex');

  return {
    format: 'csv',
    columns,
    sampleRows,
    rowCount: dataLines.length,
    fingerprint,
    suggestedMapping: guessMapping(columns),
  };
}

export type ParsedRow = { date: string; merchant: string | null; amountMinor: number };

function parseAmount(raw: string, invert: boolean): number {
  // Remove currency symbols, spaces, and handle parentheses as negative
  let s = raw.replace(/[$€£₹\s]/g, '').replace(/,/g, '');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { s = s.slice(1, -1); negative = true; }
  if (s.startsWith('-') || s.startsWith('−')) { s = s.replace(/^[-−]/, ''); negative = true; }
  const val = parseFloat(s);
  if (isNaN(val)) return 0;
  const minor = Math.round(val * 100);
  const signed = negative ? -minor : minor;
  return invert ? -signed : signed;
}

function parseDate(raw: string): string {
  const s = raw.trim();
  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) {
    return s.slice(0, 10).replace(/\//g, '-');
  }
  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  // DD/MM/YYYY (ambiguous — assume MM/DD if month ≤ 12)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}`;
  }
  // Try native Date parse as fallback
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

export function applyCsvMapping(
  buffer: Buffer,
  mapping: { dateCol: string; merchantCol: string; amountCol: string; invertAmount?: boolean },
): ParsedRow[] {
  const text = buffer.toString('utf-8');
  const lines = splitLines(text);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).reduce<ParsedRow[]>((acc, line) => {
    const vals = parseCsvLine(line);
    const get = (col: string) => vals[headers.indexOf(col)] ?? '';

    const rawDate = get(mapping.dateCol);
    const rawAmount = get(mapping.amountCol);
    if (!rawDate || !rawAmount) return acc;

    const date = parseDate(rawDate);
    const amountMinor = parseAmount(rawAmount, mapping.invertAmount ?? false);
    const merchant = mapping.merchantCol ? (get(mapping.merchantCol) || null) : null;

    acc.push({ date, merchant, amountMinor });
    return acc;
  }, []);
}
