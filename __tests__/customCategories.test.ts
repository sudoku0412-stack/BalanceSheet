const store = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    store.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    store.delete(k);
  }),
}));

import {
  CUSTOM_CATEGORY_COLORS,
  MAX_CUSTOM_CATEGORIES,
  MAX_CUSTOM_CATEGORY_NAME,
  addCustomCategory,
  clearCustomCategoriesForHousehold,
  getCustomCategories,
  removeCustomCategory,
  resolveCategoryColor,
} from '../lib/customCategories';

beforeEach(() => store.clear());

describe('addCustomCategory', () => {
  it('trims, collapses whitespace, persists, and assigns a palette color', async () => {
    const r = await addCustomCategory('h1', '  Pet   Care ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added).toEqual({ name: 'Pet Care', color: CUSTOM_CATEGORY_COLORS[0] });
    expect(await getCustomCategories('h1')).toEqual([r.added]);
  });

  it('cycles palette colors as more are added', async () => {
    await addCustomCategory('h1', 'A');
    const r = await addCustomCategory('h1', 'B');
    expect(r.ok && r.added.color).toBe(CUSTOM_CATEGORY_COLORS[1]);
  });

  it('rejects empty, too-long, built-in (any case), Recurring, and duplicate names', async () => {
    expect(await addCustomCategory('h1', '   ')).toEqual({ ok: false, reason: 'empty' });
    expect(await addCustomCategory('h1', 'x'.repeat(MAX_CUSTOM_CATEGORY_NAME + 1))).toEqual({
      ok: false,
      reason: 'tooLong',
    });
    expect(await addCustomCategory('h1', 'groceries')).toEqual({ ok: false, reason: 'duplicate' });
    expect(await addCustomCategory('h1', 'Recurring')).toEqual({ ok: false, reason: 'duplicate' });
    await addCustomCategory('h1', 'Pets');
    expect(await addCustomCategory('h1', 'pets')).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('enforces the per-household limit', async () => {
    for (let i = 0; i < MAX_CUSTOM_CATEGORIES; i += 1) {
      expect((await addCustomCategory('h1', `Cat ${i}`)).ok).toBe(true);
    }
    expect(await addCustomCategory('h1', 'One too many')).toEqual({ ok: false, reason: 'limit' });
  });

  it('keeps households isolated', async () => {
    await addCustomCategory('h1', 'Pets');
    expect(await getCustomCategories('h2')).toEqual([]);
    expect((await addCustomCategory('h2', 'Pets')).ok).toBe(true);
  });
});

describe('removeCustomCategory / clear', () => {
  it('removes only the named category', async () => {
    await addCustomCategory('h1', 'Pets');
    await addCustomCategory('h1', 'Hobbies');
    const next = await removeCustomCategory('h1', 'Pets');
    expect(next.map((c) => c.name)).toEqual(['Hobbies']);
    expect((await getCustomCategories('h1')).map((c) => c.name)).toEqual(['Hobbies']);
  });

  it('clearCustomCategoriesForHousehold wipes the list', async () => {
    await addCustomCategory('h1', 'Pets');
    await clearCustomCategoriesForHousehold('h1');
    expect(await getCustomCategories('h1')).toEqual([]);
  });
});

describe('getCustomCategories resilience', () => {
  it('returns [] for corrupt or wrongly-shaped storage', async () => {
    store.set('bs.customCategories.h1', '{not json');
    expect(await getCustomCategories('h1')).toEqual([]);
    store.set('bs.customCategories.h1', JSON.stringify([{ name: 1 }, { name: 'ok', color: '#fff' }]));
    expect(await getCustomCategories('h1')).toEqual([{ name: 'ok', color: '#fff' }]);
  });
});

describe('resolveCategoryColor', () => {
  const builtIn = { Groceries: '#111' };
  const customs = [{ name: 'Pets', color: '#222' }];
  it('prefers built-in, then custom, then fallback', () => {
    expect(resolveCategoryColor('Groceries', builtIn, customs, '#fff')).toBe('#111');
    expect(resolveCategoryColor('Pets', builtIn, customs, '#fff')).toBe('#222');
    expect(resolveCategoryColor('Deleted', builtIn, customs, '#fff')).toBe('#fff');
  });
});
