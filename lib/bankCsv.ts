import { calendarDateKey } from './calendarDate';
import { IncomeCategory } from '../types';

export type BankCsvKind = 'credit' | 'debit';

export type BankCsvRow = {
  date: string;
  description: string;
  amount: number;
  kind: BankCsvKind;
  category: IncomeCategory;
  fingerprint: string;
};

export type ParseBankCsvResult = {
  delimiter: string;
  header: string[];
  rows: BankCsvRow[];
  skipped: number;
};

const HEADER_DATE = /^(date|posted|transaction\s*date|post(ing)?\s*date|trans\.?\s*date)$/i;
const HEADER_DESC =
  /^(description|desc|details?|memo|payee|name|merchant|narrative|transaction)$/i;
const HEADER_AMOUNT = /^(amount|amt|cad\$?|usd\$?|value|transaction\s*amount)$/i;
const HEADER_DEBIT = /^(debit|withdrawal|withdrawals|out|spent)$/i;
const HEADER_CREDIT = /^(credit|deposit|deposits|in|paid\s*in)$/i;
const HEADER_TYPE = /^(type|transaction\s*type|cr\/?dr)$/i;

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const counts: Record<string, number> = {
    ',': (first.match(/,/g) || []).length,
    ';': (first.match(/;/g) || []).length,
    '\t': (first.match(/\t/g) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

/** RFC-ish CSV split that keeps quoted commas. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map((c) => c.replace(/^"(.*)"$/, '$1').trim());
}

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim();
}

function findCol(headers: string[], pred: RegExp): number {
  return headers.findIndex((h) => pred.test(h.trim()));
}

function parseAmountCell(raw: string): number | null {
  const s = raw.replace(/["'\s]/g, '').replace(/[USDCAD$]/gi, '');
  if (!s || s === '-' || s === '—' || s === '--') return null;
  const paren = s.match(/^\((.+)\)$/);
  const neg = Boolean(paren) || s.startsWith('-');
  const n = Number((paren?.[1] ?? s).replace(/,/g, '').replace(/^-/, ''));
  if (!Number.isFinite(n) || n === 0) return null;
  return neg ? -Math.abs(n) : n;
}

function parseCsvDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return calendarDateKey(`${iso[1]}-${iso[2]}-${iso[3]}`);

  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    let month = a;
    let day = b;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return calendarDateKey(
      `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }

  const named = Date.parse(s);
  if (!Number.isNaN(named)) return calendarDateKey(new Date(named).toISOString());
  return null;
}

export function guessIncomeCategory(description: string): IncomeCategory {
  const d = description.toLowerCase();
  if (/\b(payroll|salary|wage|paycheck|paycheque|direct deposit|adp|paychex|gusto)\b/.test(d)) {
    return 'Salary';
  }
  if (/\b(interest|int\.?\s*pmt|dividend|div\.|capital gain)\b/.test(d)) {
    return /dividend|capital gain/.test(d) ? 'InvestmentReturn' : 'Interest';
  }
  if (/\b(refund|rebate|cashback|cash back|reversal)\b/.test(d)) return 'Refund';
  if (/\b(gift|birthday)\b/.test(d)) return 'Gift';
  if (/\b(invoice|freelance|upwork|fiverr|1099|consulting)\b/.test(d)) return 'Freelance';
  return 'Other';
}

export function incomeFingerprint(date: string, amount: number, description: string): string {
  const amt = Math.round(Math.abs(amount) * 100);
  const desc = description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${date}|${amt}|${desc}`;
}

function typeLooksCredit(type: string): boolean | null {
  const t = type.trim().toLowerCase();
  if (!t) return null;
  if (/^(cr|credit|deposit|in|sale|interest|dividend|payroll|ach credit)$/.test(t)) return true;
  if (/^(dr|debit|withdrawal|out|purchase|fee|payment|ach debit)$/.test(t)) return false;
  return null;
}

export function parseBankCsv(text: string): ParseBankCsvResult {
  const raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw) return { delimiter: ',', header: [], rows: [], skipped: 0 };

  const delimiter = detectDelimiter(raw);
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { delimiter, header: [], rows: [], skipped: 0 };

  let headerIdx = 0;
  let headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);
  const looksLikeHeader =
    findCol(headers, HEADER_DATE) >= 0 ||
    findCol(headers, HEADER_DESC) >= 0 ||
    findCol(headers, HEADER_AMOUNT) >= 0;
  if (!looksLikeHeader && lines.length > 1) {
    // Some exports put a title row first.
    const next = splitCsvLine(lines[1], delimiter).map(normalizeHeader);
    if (
      findCol(next, HEADER_DATE) >= 0 ||
      findCol(next, HEADER_AMOUNT) >= 0 ||
      findCol(next, HEADER_CREDIT) >= 0
    ) {
      headers = next;
      headerIdx = 1;
    }
  }

  const dateCol = findCol(headers, HEADER_DATE);
  const descCol = findCol(headers, HEADER_DESC);
  const amountCol = findCol(headers, HEADER_AMOUNT);
  const debitCol = findCol(headers, HEADER_DEBIT);
  const creditCol = findCol(headers, HEADER_CREDIT);
  const typeCol = findCol(headers, HEADER_TYPE);

  const rows: BankCsvRow[] = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitCsvLine(line, delimiter);
    if (cells.every((c) => !c)) {
      skipped++;
      continue;
    }
    const date = parseCsvDate(dateCol >= 0 ? cells[dateCol] ?? '' : cells[0] ?? '');
    if (!date) {
      skipped++;
      continue;
    }

    let signed: number | null = null;
    if (creditCol >= 0 || debitCol >= 0) {
      const credit = creditCol >= 0 ? parseAmountCell(cells[creditCol] ?? '') : null;
      const debit = debitCol >= 0 ? parseAmountCell(cells[debitCol] ?? '') : null;
      if (credit != null && Math.abs(credit) > 0) signed = Math.abs(credit);
      else if (debit != null && Math.abs(debit) > 0) signed = -Math.abs(debit);
    }
    if (signed == null && amountCol >= 0) {
      signed = parseAmountCell(cells[amountCol] ?? '');
    }
    if (signed == null) {
      // Fall back: last numeric-looking cell.
      for (let i = cells.length - 1; i >= 0; i--) {
        const n = parseAmountCell(cells[i] ?? '');
        if (n != null) {
          signed = n;
          break;
        }
      }
    }
    if (signed == null || signed === 0) {
      skipped++;
      continue;
    }

    let kind: BankCsvKind = signed > 0 ? 'credit' : 'debit';
    if (typeCol >= 0) {
      const fromType = typeLooksCredit(cells[typeCol] ?? '');
      if (fromType === true) kind = 'credit';
      if (fromType === false) kind = 'debit';
    }

    const description =
      (descCol >= 0 ? cells[descCol] : cells[1])?.replace(/\s+/g, ' ').trim() || 'Imported';
    const amount = Math.abs(signed);
    const fingerprint = incomeFingerprint(date, amount, description);
    if (seen.has(fingerprint)) {
      skipped++;
      continue;
    }
    seen.add(fingerprint);

    rows.push({
      date,
      description,
      amount,
      kind,
      category: guessIncomeCategory(description),
      fingerprint,
    });
  }

  return { delimiter, header: headers, rows, skipped };
}

export function creditsOnly(rows: BankCsvRow[]): BankCsvRow[] {
  return rows.filter((r) => r.kind === 'credit');
}
