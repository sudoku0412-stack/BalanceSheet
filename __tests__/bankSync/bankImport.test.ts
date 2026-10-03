import {
  bankTransactionToReceipt,
  mapBankCategory,
  shouldImportTransaction,
  type BankTransaction,
} from '../../lib/bankImport';

const txn = (o: Partial<BankTransaction> = {}): BankTransaction => ({
  transaction_id: 't1',
  amount: 25,
  iso_currency_code: 'CAD',
  date: '2026-09-04',
  name: 'TIM HORTONS #1234',
  merchant_name: 'Tim Hortons',
  pending: false,
  personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' },
  ...o,
});

describe('mapBankCategory', () => {
  it.each([
    ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES', 'Groceries'],
    ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT', 'Dining'],
    ['ENTERTAINMENT', 'ENTERTAINMENT_MUSIC_AND_AUDIO', 'Entertainment'],
    ['MEDICAL', 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS', 'Pharmacy'],
    ['MEDICAL', 'MEDICAL_DENTAL_CARE', 'Healthcare'],
    ['TRANSPORTATION', 'TRANSPORTATION_GAS', 'Gas'],
    ['TRANSPORTATION', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'Travel'],
    ['TRAVEL', 'TRAVEL_FLIGHTS', 'Travel'],
    ['RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 'Electricity'],
    ['RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT', 'Other'],
    ['GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES', 'Clothing'],
    ['GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ELECTRONICS', 'Electronics'],
    ['GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_SUPERSTORES', 'Groceries'],
    ['GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_GIFTS', 'Other'],
    ['SOMETHING_NEW', undefined, 'Other'],
  ])('%s / %s → %s', (primary, detailed, expected) => {
    expect(mapBankCategory(primary, detailed)).toBe(expected);
  });

  it('handles missing and lowercase input', () => {
    expect(mapBankCategory()).toBe('Other');
    expect(mapBankCategory('food_and_drink', 'food_and_drink_groceries')).toBe('Groceries');
  });
});

describe('shouldImportTransaction', () => {
  it('imports a settled purchase', () => {
    expect(shouldImportTransaction(txn())).toBe(true);
  });

  it('skips pending, zero/negative amounts, and non-expense categories', () => {
    expect(shouldImportTransaction(txn({ pending: true }))).toBe(false);
    expect(shouldImportTransaction(txn({ amount: 0 }))).toBe(false);
    expect(shouldImportTransaction(txn({ amount: -50 }))).toBe(false); // deposit/refund
    for (const primary of ['INCOME', 'TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'BANK_FEES']) {
      expect(shouldImportTransaction(txn({ personal_finance_category: { primary } }))).toBe(false);
    }
  });

  it('imports when there is no category info', () => {
    expect(shouldImportTransaction(txn({ personal_finance_category: null }))).toBe(true);
  });
});

describe('bankTransactionToReceipt', () => {
  const now = '2026-09-05T00:00:00.000Z';

  it('builds a USD-canonical receipt keeping the bank id and original currency', () => {
    const r = bankTransactionToReceipt(txn({ amount: 13.8 }), 'CAD', 'rid', now);
    expect(r).toMatchObject({
      id: 'rid',
      storeName: 'Tim Hortons',
      category: 'Dining',
      categoryTags: ['Dining'],
      originalCurrency: 'CAD',
      bankTxnId: 't1',
      createdAt: now,
      updatedAt: now,
    });
    expect(r.totalAmount).toBeCloseTo(10, 6); // 13.80 CAD at the fixed 1.38 rate
    expect(r.notes).toBe('TIM HORTONS #1234');
  });

  it('keeps the calendar date regardless of timezone (stored at local noon)', () => {
    const r = bankTransactionToReceipt(txn({ date: '2026-09-04' }), 'USD', 'rid', now);
    const d = new Date(r.date);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 4]);
  });

  it('falls back to the profile currency for unknown currencies and to the raw name for merchants', () => {
    const r = bankTransactionToReceipt(
      txn({ iso_currency_code: 'XXX', merchant_name: null, name: '  Corner Store ', amount: 10 }),
      'USD',
      'rid',
      now,
    );
    expect(r.originalCurrency).toBe('USD');
    expect(r.totalAmount).toBe(10);
    expect(r.storeName).toBe('Corner Store');
    expect(r.notes).toBeUndefined();
  });

  it('never produces an empty or oversized store name', () => {
    expect(bankTransactionToReceipt(txn({ merchant_name: null, name: '  ' }), 'USD', 'r', now).storeName).toBe(
      'Bank transaction',
    );
    expect(bankTransactionToReceipt(txn({ merchant_name: 'x'.repeat(200) }), 'USD', 'r', now).storeName).toHaveLength(80);
  });
});
