/** Money-input helpers shared by every screen with a free-typed amount
 *  field (scan, edit, split, item entry). Accepts either `.` or `,` as
 *  the decimal separator (locale-dependent), at most one of either, and
 *  at most 2 fractional digits — anything else (letters, a second
 *  separator like `12.50.99`) is rejected instead of silently truncated
 *  by parseFloat. */

export function sanitizeAmountInput(text: string): string {
  let out = '';
  let seenSeparator = false;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if ((ch === '.' || ch === ',') && !seenSeparator) {
      out += ch;
      seenSeparator = true;
    }
  }
  return out;
}

/** Returns the parsed amount, or null if `text` isn't a valid money value. */
export function parseAmountInput(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return parseFloat(normalized);
}
