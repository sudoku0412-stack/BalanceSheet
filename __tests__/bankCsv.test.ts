import {
  creditsOnly,
  guessIncomeCategory,
  incomeFingerprint,
  parseBankCsv,
  splitCsvLine,
} from '../lib/bankCsv';

describe('splitCsvLine', () => {
  it('keeps quoted commas', () => {
    expect(splitCsvLine('2026-03-01,"Acme, Inc payroll",3200.00', ',')).toEqual([
      '2026-03-01',
      'Acme, Inc payroll',
      '3200.00',
    ]);
  });
});

describe('parseBankCsv', () => {
  it('parses signed-amount credits and debits', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-03-01,Acme payroll,3200.00',
      '2026-03-02,Grocery store,-54.10',
    ].join('\n');
    const result = parseBankCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      date: '2026-03-01',
      description: 'Acme payroll',
      amount: 3200,
      kind: 'credit',
      category: 'Salary',
    });
    expect(result.rows[1].kind).toBe('debit');
    expect(creditsOnly(result.rows)).toHaveLength(1);
  });

  it('parses debit/credit columns and US dates', () => {
    const csv = [
      'Transaction Date,Details,Debit,Credit',
      '03/01/2026,Interest payment,,2.15',
      '03/02/2026,ATM withdrawal,40.00,',
    ].join('\n');
    const result = parseBankCsv(csv);
    expect(result.rows[0]).toMatchObject({
      date: '2026-03-01',
      kind: 'credit',
      amount: 2.15,
      category: 'Interest',
    });
    expect(result.rows[1]).toMatchObject({ kind: 'debit', amount: 40 });
  });

  it('dedupes identical rows inside the file', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-03-01,Payroll,100',
      '2026-03-01,Payroll,100',
    ].join('\n');
    const result = parseBankCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('treats day-first dates when the first number is > 12', () => {
    const csv = 'Date,Description,Amount\n15/03/2026,Refund,20.00';
    expect(parseBankCsv(csv).rows[0].date).toBe('2026-03-15');
    expect(parseBankCsv(csv).rows[0].category).toBe('Refund');
  });
});

describe('guessIncomeCategory / fingerprint', () => {
  it('classifies common descriptions', () => {
    expect(guessIncomeCategory('Questrade dividend')).toBe('InvestmentReturn');
    expect(guessIncomeCategory('Upwork invoice')).toBe('Freelance');
    expect(guessIncomeCategory('Birthday gift')).toBe('Gift');
  });

  it('normalizes fingerprints', () => {
    expect(incomeFingerprint('2026-03-01', 10.5, 'Acme  Payroll')).toBe(
      incomeFingerprint('2026-03-01', 10.5, 'acme payroll'),
    );
  });
});
