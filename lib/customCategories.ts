import * as SecureStore from 'expo-secure-store';
import { ALL_CATEGORIES } from '../constants/categories';

/** A user-defined spending category (Premium). Assignable to line items
 *  and budgetable like the built-in ones. Stored per household, on this
 *  device: budgets for it sync through the household budgets doc, the
 *  definition (icon/color) does not — other members fall back to a
 *  neutral color for an unknown name. */
export interface CustomCategory {
  name: string;
  color: string;
}

export const MAX_CUSTOM_CATEGORIES = 20;
export const MAX_CUSTOM_CATEGORY_NAME = 24;

/** Cycled in order as the user adds categories. */
export const CUSTOM_CATEGORY_COLORS = [
  '#D6336C',
  '#0CA678',
  '#F08C00',
  '#7048E8',
  '#1C7ED6',
  '#E8590C',
  '#099268',
  '#AE3EC9',
];

const KEY = 'bs.customCategories';

const storageKey = (householdId: string) => `${KEY}.${householdId}`;

function isCustomCategory(v: unknown): v is CustomCategory {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as CustomCategory).name === 'string' &&
    typeof (v as CustomCategory).color === 'string'
  );
}

export async function getCustomCategories(householdId: string): Promise<CustomCategory[]> {
  const raw = await SecureStore.getItemAsync(storageKey(householdId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCustomCategory) : [];
  } catch {
    return [];
  }
}

async function save(householdId: string, list: CustomCategory[]): Promise<void> {
  await SecureStore.setItemAsync(storageKey(householdId), JSON.stringify(list));
}

export type AddCustomCategoryResult =
  | { ok: true; categories: CustomCategory[]; added: CustomCategory }
  | { ok: false; reason: 'empty' | 'tooLong' | 'duplicate' | 'limit' };

/** Validates and appends a category. Names are trimmed, collapsed, and
 *  compared case-insensitively against built-ins (which include the
 *  Recurring budget key) and existing customs. */
export async function addCustomCategory(
  householdId: string,
  rawName: string,
): Promise<AddCustomCategoryResult> {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, reason: 'empty' };
  if (name.length > MAX_CUSTOM_CATEGORY_NAME) return { ok: false, reason: 'tooLong' };
  const existing = await getCustomCategories(householdId);
  if (existing.length >= MAX_CUSTOM_CATEGORIES) return { ok: false, reason: 'limit' };
  const taken = new Set(
    [...ALL_CATEGORIES, ...existing.map((c) => c.name)].map((n) =>
      n.toLowerCase(),
    ),
  );
  if (taken.has(name.toLowerCase())) return { ok: false, reason: 'duplicate' };
  const added: CustomCategory = {
    name,
    color: CUSTOM_CATEGORY_COLORS[existing.length % CUSTOM_CATEGORY_COLORS.length],
  };
  const categories = [...existing, added];
  await save(householdId, categories);
  return { ok: true, categories, added };
}

/** Removes the definition only. Line items already tagged with the name
 *  keep it (still counted and shown) so no spending history is lost. */
export async function removeCustomCategory(
  householdId: string,
  name: string,
): Promise<CustomCategory[]> {
  const next = (await getCustomCategories(householdId)).filter((c) => c.name !== name);
  await save(householdId, next);
  return next;
}

export async function clearCustomCategoriesForHousehold(householdId: string): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(householdId));
}

/** Color for any category name: built-in palette first, then a custom
 *  definition, else the neutral fallback (unknown/deleted/other member's). */
export function resolveCategoryColor(
  name: string,
  builtIn: Record<string, string>,
  customs: CustomCategory[],
  fallback: string,
): string {
  return builtIn[name] ?? customs.find((c) => c.name === name)?.color ?? fallback;
}
