import { tr } from './i18n';
import { LineItem } from '../types';

/**
 * Check whether the receipt's line items actually sum to the printed
 * subtotal. The OCR + AI pipeline can occasionally miscount on
 * tricky layouts (multi-row deals, dropped discount lines, OCR'd
 * digits that became letters), and silent miscounts erode trust in
 * the parsed output. We surface them as a banner-and-alert prompt
 * so the user knows to double-check.
 *
 * Behaviour:
 *   - Returns `{ ok: true }` when items match subtotal within the
 *     rounding tolerance (default $0.50, accounting for per-item
 *     bankers'-rounding drift and minor OCR slop on cents).
 *   - Returns `{ ok: false, ... }` with the diff and a one-line
 *     hint when they don't.
 *   - Returns `{ ok: true, skipped: true }` when there's no subtotal
 *     printed on the receipt (nothing to compare against).
 *
 * We DO NOT try to auto-correct: the safe thing is to flag the
 * mismatch and let the user adjust, since "fixing" the wrong line
 * is worse than leaving the parse alone.
 */
export type ItemsTotalCheck =
  | { ok: true; skipped?: boolean; sum: number }
  | {
      ok: false;
      sum: number;
      subtotal: number;
      diff: number;
      hint: string;
    };

export function checkItemsAgainstSubtotal(
  items: LineItem[],
  subtotal: number | null | undefined,
  toleranceDollars = 0.5,
): ItemsTotalCheck {
  const sum = round2(items.reduce((s, it) => s + (it.amount || 0), 0));
  if (subtotal == null || !Number.isFinite(subtotal) || subtotal <= 0) {
    return { ok: true, skipped: true, sum };
  }
  const diff = round2(sum - subtotal);
  if (Math.abs(diff) <= toleranceDollars) {
    return { ok: true, sum };
  }
  return {
    ok: false,
    sum,
    subtotal: round2(subtotal),
    diff,
    hint: diff > 0 ? hintWhenOver(items, diff) : hintWhenUnder(diff),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Items add up to more than the subtotal — usually a duplicated line
 * or a discount that should have been negative. If the diff matches
 * any single item's amount within a cent, that item is the prime
 * suspect.
 */
function hintWhenOver(items: LineItem[], diff: number): string {
  const suspect = items.find((it) => Math.abs(it.amount - diff) < 0.02);
  if (suspect) {
    return tr('itemTwiceHint', { name: suspect.name, diff: `$${diff.toFixed(2)}` });
  }
  return tr('itemsOverHint', { diff: `$${diff.toFixed(2)}` });
}

/**
 * Items add up to LESS than the subtotal — usually a missing line
 * (OCR dropped it) or an amount typed without its dollars digit.
 */
function hintWhenUnder(diff: number): string {
  const missing = Math.abs(diff).toFixed(2);
  return tr('itemsUnderHint', { diff: `$${missing}` });
}
