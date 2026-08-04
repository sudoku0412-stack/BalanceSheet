import { Category } from '../types';
import { CATEGORY_KEYWORDS, ITEM_CATEGORY_HINTS } from '../constants/categories';

/**
 * Detect the category for a whole receipt based on store name + full text.
 * Store-name matches carry triple weight.
 */
export function detectCategory(storeName: string, text: string): Category {
  const combined = `${storeName} ${text}`.toLowerCase();
  const storeLower = storeName.toLowerCase();

  const scores: Record<Category, number> = {
    Groceries: 0, Electronics: 0, Dining: 0, Pharmacy: 0, Gas: 0,
    Clothing: 0, Entertainment: 0, Travel: 0, Healthcare: 0, Electricity: 0, Recurring: 0, Other: 0,
  };

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]) {
    for (const keyword of keywords) {
      const k = keyword.toLowerCase();
      if (combined.includes(k)) {
        scores[category] += storeLower.includes(k) ? 3 : 1;
      }
    }
  }

  const top = (Object.entries(scores) as [Category, number][]).sort(([, a], [, b]) => b - a)[0];
  return top[1] > 0 ? top[0] : 'Other';
}

/**
 * Strip noise from a line-item name before keyword matching:
 *  - 8–14 digit UPC / SKU codes
 *  - trailing single status letter (Walmart 'J' / 'D', Costco 'E', etc.)
 *  - leading/trailing punctuation and collapsed whitespace
 */
export function cleanItemName(name: string): string {
  return name
    .replace(/\b\d{8,14}\b/g, ' ')          // UPC / SKU
    .replace(/\s+[A-Z]\s*$/, ' ')           // trailing single status letter
    .replace(/[^a-zA-Z0-9 .'/&%-]+/g, ' ')  // stray punctuation (keep & for "salt & pepper")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Categorize a single line item name. Uses ITEM_CATEGORY_HINTS exclusively
 * — receipt-level CATEGORY_KEYWORDS (mostly store names) are intentionally
 * NOT consulted here, because matching "fresh" or "next" against an item
 * name produces false positives.
 *
 * The matching is space-padded so that a hint like " choc " only matches a
 * standalone word, not a substring of "honchocode". Hints already in
 * ITEM_CATEGORY_HINTS that need standalone matching include leading/trailing
 * spaces (e.g. ' tea ', ' choc ', ' tie ').
 */
export function categorizeItem(name: string): Category {
  const cleaned = cleanItemName(name).toLowerCase();
  if (!cleaned) return 'Other';
  // Pad with spaces so " word " hints can match at start/end of input.
  const padded = ` ${cleaned} `;

  const scores: Record<Category, number> = {
    Groceries: 0, Electronics: 0, Dining: 0, Pharmacy: 0, Gas: 0,
    Clothing: 0, Entertainment: 0, Travel: 0, Healthcare: 0, Electricity: 0, Recurring: 0, Other: 0,
  };

  for (const [category, hints] of Object.entries(ITEM_CATEGORY_HINTS) as [
    Category,
    string[],
  ][]) {
    for (const raw of hints ?? []) {
      const hint = raw.toLowerCase();
      // If the hint already has space padding, search the padded input;
      // otherwise plain substring match.
      const haystack = hint.startsWith(' ') || hint.endsWith(' ') ? padded : cleaned;
      if (haystack.includes(hint)) scores[category] += 1;
    }
  }

  // Stable sort: insertion order in ITEM_CATEGORY_HINTS resolves ties, which
  // intentionally biases towards Groceries → Healthcare → Pharmacy → ...
  const top = (Object.entries(scores) as [Category, number][]).sort(
    ([, a], [, b]) => b - a,
  )[0];
  return top[1] > 0 ? top[0] : 'Other';
}
