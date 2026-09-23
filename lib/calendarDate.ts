/**
 * Local calendar-day keys for mixed date storage.
 *
 * Receipts are often full ISO timestamps (`toISOString()`). Income dates
 * from the date picker are civil `YYYY-MM-DD` strings. Parsing those with
 * `new Date('YYYY-MM-DD')` means UTC midnight, which is still the previous
 * evening in US timezones — so a March 1 income stayed in March while a
 * March 1 date-only expense fell out of the month and net was wrong.
 *
 * Rule: a date-only string IS that civil day. A timestamp is the local
 * calendar day of that instant.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function calendarDateKey(dateStr: string): string | null {
  const s = dateStr.trim();
  if (DATE_ONLY.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return formatLocalDate(d);
}

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function calendarMonthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

export function isInCalendarMonth(dateStr: string, year: number, month: number): boolean {
  const key = calendarDateKey(dateStr);
  if (!key) return false;
  const { start, end } = calendarMonthBounds(year, month);
  return key >= start && key <= end;
}

export function isInCalendarRange(dateStr: string, start: Date, end: Date): boolean {
  const key = calendarDateKey(dateStr);
  if (!key) return false;
  return key >= formatLocalDate(start) && key <= formatLocalDate(end);
}

/**
 * SQL fragment matching `isInCalendarMonth` for a `date` column that may
 * hold either `YYYY-MM-DD` or a full ISO timestamp.
 * Bind order: startKey, endKey, startIso, endIso.
 */
export function calendarMonthSql(column = 'date'): string {
  return ` AND (
    (length(${column}) <= 10 AND substr(${column}, 1, 10) >= ? AND substr(${column}, 1, 10) <= ?)
    OR
    (length(${column}) > 10 AND ${column} >= ? AND ${column} <= ?)
  )`;
}

export function calendarMonthSqlParams(year: number, month: number): string[] {
  const { start, end } = calendarMonthBounds(year, month);
  const startIso = new Date(year, month - 1, 1, 0, 0, 0, 0).toISOString();
  const endIso = new Date(year, month, 0, 23, 59, 59, 999).toISOString();
  return [start, end, startIso, endIso];
}
