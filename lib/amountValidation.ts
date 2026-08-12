/** Money-input helpers shared by every screen with a free-typed amount
 *  field (scan, edit, split, item entry). `sanitizeAmountInput` just
 *  strips non-money characters (letters etc.) as the user types;
 *  `parseAmountInput` does the real validation at save time — it
 *  treats the LAST `.`/`,` in the string as the decimal separator (so
 *  a pasted thousands-grouped amount like `1,234.56` or `1.234,56`
 *  parses correctly) and rejects anything with more than one instance
 *  of that separator character (e.g. `12.50.99`, which is genuinely
 *  malformed rather than grouped) instead of silently truncating it
 *  the way `parseFloat` used to. */

export function sanitizeAmountInput(text: string): string {
  let out = '';
  for (const ch of text) {
    if ((ch >= '0' && ch <= '9') || ch === '.' || ch === ',') {
      out += ch;
    }
  }
  return out;
}

/** Returns the parsed amount, or null if `text` isn't a valid money value. */
export function parseAmountInput(text: string): number | null {
  const s = text.trim();
  if (!s) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const decimalIndex = Math.max(lastDot, lastComma);

  let normalized: string;
  if (decimalIndex === -1) {
    normalized = s;
  } else {
    const decimalChar = s[decimalIndex];
    const thousandsChar = decimalChar === '.' ? ',' : '.';
    // More than one instance of the character we're treating as the
    // decimal point (not the thousands separator) means the input is
    // actually malformed, e.g. "12.50.99" — not a grouped paste.
    if (s.split(decimalChar).length - 1 > 1) return null;
    const intPart = s.slice(0, decimalIndex).split(thousandsChar).join('');
    const fracPart = s.slice(decimalIndex + 1);
    normalized = `${intPart}.${fracPart}`;
  }

  if (!/^\d*(\.\d{0,2})?$/.test(normalized) || !/\d/.test(normalized)) return null;
  return parseFloat(normalized);
}
