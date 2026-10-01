import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('../../lib/cloudSync', () => ({
  syncCustomCategoriesToCloud: jest.fn(async () => {}),
}));

jest.mock('../../lib/customCategories', () => ({
  MAX_CUSTOM_CATEGORY_NAME: 24,
  addCustomCategory: jest.fn(),
}));

import { CustomCategoryPicker } from '../../components/ui/CustomCategoryPicker';
import { addCustomCategory } from '../../lib/customCategories';
import { syncCustomCategoriesToCloud } from '../../lib/cloudSync';

const mockAdd = addCustomCategory as jest.Mock;

function setup(overrides: Partial<React.ComponentProps<typeof CustomCategoryPicker>> = {}) {
  const props = {
    householdId: 'h1',
    customs: [{ name: 'Pets', color: '#D6336C' }],
    selected: '',
    isPremium: true,
    onSelect: jest.fn(),
    onCustomsChange: jest.fn(),
    onUpgrade: jest.fn(),
    ...overrides,
  };
  render(<CustomCategoryPicker {...props} />);
  return props;
}

beforeEach(() => jest.clearAllMocks());

describe('CustomCategoryPicker', () => {
  it('lists custom chips and selects one on press', () => {
    const p = setup();
    fireEvent.press(screen.getByTestId('custom-chip-Pets'));
    expect(p.onSelect).toHaveBeenCalledWith('Pets');
  });

  it('free user: add button says Premium and opens the paywall', () => {
    const p = setup({ isPremium: false });
    expect(screen.getByText('Custom category · Premium')).toBeTruthy();
    fireEvent.press(screen.getByTestId('custom-category-add'));
    expect(p.onUpgrade).toHaveBeenCalled();
    expect(screen.queryByTestId('custom-category-input')).toBeNull();
  });

  it('free user still sees and can pick existing custom chips', () => {
    const p = setup({ isPremium: false });
    fireEvent.press(screen.getByTestId('custom-chip-Pets'));
    expect(p.onSelect).toHaveBeenCalledWith('Pets');
  });

  it('premium: adds a category, selects it, and closes the input', async () => {
    const added = { name: 'Hobbies', color: '#0CA678' };
    mockAdd.mockResolvedValue({ ok: true, added, categories: [{ name: 'Pets', color: '#D6336C' }, added] });
    const p = setup();
    fireEvent.press(screen.getByTestId('custom-category-add'));
    fireEvent.changeText(screen.getByTestId('custom-category-input'), 'Hobbies');
    fireEvent.press(screen.getByTestId('custom-category-save'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith('h1', 'Hobbies'));
    await waitFor(() => expect(p.onSelect).toHaveBeenCalledWith('Hobbies'));
    expect(p.onCustomsChange).toHaveBeenCalledWith([{ name: 'Pets', color: '#D6336C' }, added]);
    expect(syncCustomCategoriesToCloud).toHaveBeenCalledWith('h1', { add: [added] });
    await waitFor(() => expect(screen.queryByTestId('custom-category-input')).toBeNull());
  });

  it('premium: shows a validation error and keeps the input open', async () => {
    mockAdd.mockResolvedValue({ ok: false, reason: 'duplicate' });
    const p = setup();
    fireEvent.press(screen.getByTestId('custom-category-add'));
    fireEvent.changeText(screen.getByTestId('custom-category-input'), 'Pets');
    fireEvent.press(screen.getByTestId('custom-category-save'));
    await waitFor(() => expect(screen.getByText('That category already exists.')).toBeTruthy());
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(syncCustomCategoriesToCloud).not.toHaveBeenCalled();
    expect(screen.getByTestId('custom-category-input')).toBeTruthy();
  });

  it('does nothing without a household id', async () => {
    setup({ householdId: null });
    fireEvent.press(screen.getByTestId('custom-category-add'));
    fireEvent.changeText(screen.getByTestId('custom-category-input'), 'Hobbies');
    fireEvent.press(screen.getByTestId('custom-category-save'));
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
