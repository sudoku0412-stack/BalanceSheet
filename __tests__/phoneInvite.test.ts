const mockAddHouseholdMemberByPhone = jest.fn();

jest.mock('../lib/cloudSync', () => ({
  addHouseholdMemberByPhone: (...args: unknown[]) => mockAddHouseholdMemberByPhone(...args),
}));

import { addByPhone } from '../lib/phoneInvite';

beforeEach(() => {
  jest.clearAllMocks();
});

const baseArgs = {
  phoneE164: '+14165551234',
  householdId: 'h1',
  householdName: 'The Smiths',
  invitedByUid: 'u1',
  invitedByName: 'Alice',
};

describe('addByPhone', () => {
  it('passes through an ok:false result unchanged', async () => {
    mockAddHouseholdMemberByPhone.mockResolvedValue({ ok: false, reason: 'not found' });
    const result = await addByPhone(baseArgs);
    expect(result).toEqual({ ok: false, reason: 'not found' });
  });

  it('passes through the matched displayName on a match', async () => {
    mockAddHouseholdMemberByPhone.mockResolvedValue({ ok: true, matched: true, displayName: 'Bob' });
    const result = await addByPhone(baseArgs);
    expect(result).toEqual({ ok: true, matched: true, displayName: 'Bob' });
  });

  it('passes through a null displayName on a match', async () => {
    mockAddHouseholdMemberByPhone.mockResolvedValue({ ok: true, matched: true, displayName: null });
    const result = await addByPhone(baseArgs);
    expect(result).toEqual({ ok: true, matched: true, displayName: null });
  });

  it('builds an invite text with inviter name and household name on no-match', async () => {
    mockAddHouseholdMemberByPhone.mockResolvedValue({ ok: true, matched: false });
    const result = await addByPhone(baseArgs);
    expect(result.ok).toBe(true);
    if (result.ok && !result.matched) {
      expect(result.inviteText).toContain('Alice');
      expect(result.inviteText).toContain('The Smiths');
      expect(result.inviteText).toContain('BalanceSheet');
    } else {
      throw new Error('expected no-match branch');
    }
  });

  it('falls back to "Someone" when invitedByName is blank', async () => {
    mockAddHouseholdMemberByPhone.mockResolvedValue({ ok: true, matched: false });
    const result = await addByPhone({ ...baseArgs, invitedByName: '   ' });
    if (result.ok && !result.matched) {
      expect(result.inviteText).toContain('Someone');
    } else {
      throw new Error('expected no-match branch');
    }
  });

  it('falls back to "their household" when householdName is blank', async () => {
    mockAddHouseholdMemberByPhone.mockResolvedValue({ ok: true, matched: false });
    const result = await addByPhone({ ...baseArgs, householdName: null });
    if (result.ok && !result.matched) {
      expect(result.inviteText).toContain('their household');
    } else {
      throw new Error('expected no-match branch');
    }
  });

  it('falls back to both defaults when invitedByName and householdName are blank', async () => {
    mockAddHouseholdMemberByPhone.mockResolvedValue({ ok: true, matched: false });
    const result = await addByPhone({ ...baseArgs, invitedByName: null, householdName: '' });
    if (result.ok && !result.matched) {
      expect(result.inviteText).toContain('Someone');
      expect(result.inviteText).toContain('their household');
    } else {
      throw new Error('expected no-match branch');
    }
  });
});
