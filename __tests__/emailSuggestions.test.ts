import { suggestEmailCompletions } from '../lib/emailSuggestions';

describe('suggestEmailCompletions', () => {
  it('returns [] before an @ is typed', () => {
    expect(suggestEmailCompletions('abc')).toEqual([]);
  });

  it('returns [] when the local part is empty', () => {
    expect(suggestEmailCompletions('@')).toEqual([]);
  });

  it('suggests common domains right after @, capped at 4', () => {
    const result = suggestEmailCompletions('abc@');
    expect(result.length).toBe(4);
    expect(result[0]).toBe('abc@gmail.com');
    expect(result.every((s) => s.startsWith('abc@'))).toBe(true);
  });

  it('filters suggestions to domains matching what was typed so far', () => {
    expect(suggestEmailCompletions('abc@gm')).toEqual(['abc@gmail.com']);
  });

  it('is case-insensitive on the typed domain fragment', () => {
    expect(suggestEmailCompletions('abc@GM')).toEqual(['abc@gmail.com']);
  });

  it('returns [] once the domain looks complete (contains a dot)', () => {
    expect(suggestEmailCompletions('abc@gmail.co')).toEqual([]);
  });

  it('returns [] when no common domain matches the typed fragment', () => {
    expect(suggestEmailCompletions('abc@zzz')).toEqual([]);
  });
});
