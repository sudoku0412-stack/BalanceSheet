import { calendarDateKey } from './calendarDate';
import { IncomeCategory } from '../types';

export type ParsedPaystub = {
  amount: number | null;
  date: string | null;
  sourceName: string;
  category: IncomeCategory;
  notes?: string;
  /** high when net pay + a date were found. */
  confidence: 'high' | 'low';
};

const MONEY =
  /(?:USD|CAD|\$|US\$|C\$)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})\b/;

const NET_LABEL =
  /\b(?:net\s*(?:pay|earnings|amount|wages|deposit)|take[\s-]?home(?:\s*pay)?|direct\s*deposit|net\s*check)\b/i;

const GROSS_LABEL = /\b(?:gross\s*(?:pay|earnings|amount|wages)|total\s*earnings)\b/i;

const EMPLOYER_LABEL = /\b(?:employer|company|organization|organisation|paid\s*by)\s*[:\-]\s*(.+)$/i;

const DATE_LABEL =
  /\b(?:pay\s*date|payday|payment\s*date|check\s*date|cheque\s*date|period\s*ending|pay\s*period\s*end(?:ing)?|ending)\b/i;

const DATE_TOKEN =
  /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i;

function parseMoney(raw: string): number | null {
  const m = raw.match(MONEY);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseLooseDate(raw: string): string | null {
  const token = raw.match(DATE_TOKEN)?.[1];
  if (!token) return null;
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return calendarDateKey(token);

  const slash = token.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    // Ambiguous 1-12/1-12: treat as US MM/DD. If first part > 12, it's D/M.
    let month = a;
    let day = b;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const padded = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return calendarDateKey(padded);
  }

  const named = Date.parse(token);
  if (!Number.isNaN(named)) {
    return calendarDateKey(new Date(named).toISOString());
  }
  return null;
}

function looksLikeAddressOrJunk(line: string): boolean {
  return (
    /\d{3,}/.test(line) ||
    /\b(street|st\.|ave|avenue|rd\.|road|suite|unit|po box|phone|ein|ssn)\b/i.test(line) ||
    /@/.test(line) ||
    line.length < 3
  );
}

function pickEmployer(lines: string[]): string {
  for (const line of lines) {
    const labeled = line.match(EMPLOYER_LABEL);
    if (labeled?.[1]?.trim()) return labeled[1].trim().replace(/\s+/g, ' ');
  }
  for (const line of lines.slice(0, 8)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (NET_LABEL.test(trimmed) || GROSS_LABEL.test(trimmed) || DATE_LABEL.test(trimmed)) continue;
    if (parseMoney(trimmed) && trimmed.length < 24) continue;
    if (looksLikeAddressOrJunk(trimmed)) continue;
    if (/pay\s*stub|earnings\s*statement|wage\s*statement/i.test(trimmed)) continue;
    return trimmed.replace(/\s+/g, ' ').slice(0, 80);
  }
  return '';
}

function amountNearLabel(lines: string[], label: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!label.test(line)) continue;
    const same = parseMoney(line);
    if (same != null) return same;
    const next = lines[i + 1] ? parseMoney(lines[i + 1]) : null;
    if (next != null) return next;
  }
  return null;
}

function dateNearLabel(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!label.test(line)) continue;
    const same = parseLooseDate(line);
    if (same) return same;
    const next = lines[i + 1] ? parseLooseDate(lines[i + 1]) : null;
    if (next) return next;
  }
  return null;
}

/** Heuristic pay-stub parse from on-device OCR text. Prefers net pay. */
export function parsePaystubText(rawText: string): ParsedPaystub {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const net = amountNearLabel(lines, NET_LABEL);
  const gross = amountNearLabel(lines, GROSS_LABEL);
  const amount = net ?? gross;
  const date = dateNearLabel(lines, DATE_LABEL) ?? (() => {
    for (const line of lines) {
      const d = parseLooseDate(line);
      if (d) return d;
    }
    return null;
  })();
  const sourceName = pickEmployer(lines);
  const notesParts = ['Scanned from pay stub'];
  if (net != null && gross != null && Math.abs(gross - net) > 0.009) {
    notesParts.push(`Gross ${gross.toFixed(2)}`);
  }

  return {
    amount,
    date,
    sourceName,
    category: 'Salary',
    notes: notesParts.join(' · '),
    confidence: net != null && date != null ? 'high' : 'low',
  };
}
