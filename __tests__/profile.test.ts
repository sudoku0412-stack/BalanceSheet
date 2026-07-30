import {
  MAX_NAME_LEN,
  ProfileDraft,
  isProfileValidationClean,
  validateProfileDraft,
} from '../lib/profileValidation';

const validDraft: ProfileDraft = {
  firstName: 'Jane',
  lastName: 'Doe',
};

describe('validateProfileDraft', () => {
  it('accepts a fully valid draft', () => {
    expect(validateProfileDraft(validDraft)).toEqual({});
    expect(isProfileValidationClean(validateProfileDraft(validDraft))).toBe(true);
  });

  it('trims whitespace before checking emptiness', () => {
    expect(validateProfileDraft({ ...validDraft, firstName: '  Jane  ' })).toEqual({});
  });

  describe('first name', () => {
    it('rejects empty', () => {
      expect(validateProfileDraft({ ...validDraft, firstName: '' }).firstName).toBeTruthy();
      expect(validateProfileDraft({ ...validDraft, firstName: '   ' }).firstName).toBeTruthy();
    });

    it('rejects names over the max length', () => {
      const long = 'a'.repeat(MAX_NAME_LEN + 1);
      expect(validateProfileDraft({ ...validDraft, firstName: long }).firstName).toBeTruthy();
    });
  });

  describe('last name', () => {
    it('is optional — empty passes', () => {
      expect(validateProfileDraft({ ...validDraft, lastName: '' }).lastName).toBeUndefined();
    });

    it('accepts at the max length', () => {
      const ok = 'a'.repeat(MAX_NAME_LEN);
      expect(validateProfileDraft({ ...validDraft, lastName: ok }).lastName).toBeUndefined();
    });

    it('rejects over the max length', () => {
      const long = 'a'.repeat(MAX_NAME_LEN + 1);
      expect(validateProfileDraft({ ...validDraft, lastName: long }).lastName).toBeTruthy();
    });
  });

  it('reports multiple errors at once (no early return)', () => {
    const draft: ProfileDraft = { firstName: '', lastName: 'a'.repeat(MAX_NAME_LEN + 1) };
    const errs = validateProfileDraft(draft);
    expect(errs.firstName).toBeTruthy();
    expect(errs.lastName).toBeTruthy();
  });
});

describe('isProfileValidationClean', () => {
  it('returns true on empty error object', () => {
    expect(isProfileValidationClean({})).toBe(true);
  });

  it('returns false when any field has an error', () => {
    expect(isProfileValidationClean({ firstName: 'oops' })).toBe(false);
  });
});
