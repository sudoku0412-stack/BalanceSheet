/**
 * ensureMembershipForCurrentHousehold must keep `isDefault` exclusive
 * across a user's memberships. leaveHousehold and households.tsx's
 * performDelete both read `isDefault` to decide which household
 * becomes active if the current one goes away — a stale flag left
 * over from an earlier switch would pick the wrong one.
 */

type DocData = Record<string, unknown>;

class FakeDocRef {
  constructor(
    private store: Map<string, DocData>,
    public path: string,
    public id: string,
  ) {}

  async get() {
    const data = this.store.get(this.path);
    return {
      exists: data !== undefined,
      id: this.id,
      data: () => data,
      ref: this,
    };
  }

  async set(data: DocData, opts?: { merge?: boolean }) {
    const existing = this.store.get(this.path);
    this.store.set(this.path, opts?.merge && existing ? { ...existing, ...data } : { ...data });
  }

  async delete() {
    this.store.delete(this.path);
  }

  collection(name: string) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }
}

class FakeCollectionRef {
  constructor(
    private store: Map<string, DocData>,
    private path: string,
  ) {}

  doc(id: string) {
    return new FakeDocRef(this.store, `${this.path}/${id}`, id);
  }

  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map(([key, data]) => {
        const id = key.slice(prefix.length);
        return { id, data: () => data, ref: new FakeDocRef(this.store, key, id) };
      });
    return { docs };
  }
}

function makeFakeFirestore() {
  const store = new Map<string, DocData>();
  const db = {
    collection: (name: string) => new FakeCollectionRef(store, name),
    batch: () => {
      const ops: Array<() => Promise<void>> = [];
      return {
        set: (ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }) => {
          ops.push(() => ref.set(data, opts));
        },
        update: (ref: FakeDocRef, data: DocData) => {
          ops.push(() => ref.set(data, { merge: true }));
        },
        delete: (ref: FakeDocRef) => {
          ops.push(() => ref.delete());
        },
        commit: async () => {
          for (const op of ops) await op();
        },
      };
    },
  };
  const firestore = () => db;
  firestore.FieldValue = {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    arrayUnion: (...items: unknown[]) => ({ __op: 'arrayUnion', items }),
    arrayRemove: (...items: unknown[]) => ({ __op: 'arrayRemove', items }),
    increment: (n: number) => ({ __op: 'increment', n }),
  };
  return { firestore, store };
}

const { firestore: mockFirestoreFn, store: mockStore } = makeFakeFirestore();

jest.mock('@react-native-firebase/firestore', () => ({
  default: mockFirestoreFn,
}));

import { ensureMembershipForCurrentHousehold, getUserMemberships } from '../../lib/cloudSync';

const uid = 'uid-1';

function seedMembership(hid: string, isDefault: boolean, ownerUid = uid) {
  mockStore.set(`users/${uid}/memberships/${hid}`, {
    householdId: hid,
    role: 'owner',
    isDefault,
  });
  mockStore.set(`households/${hid}`, { ownerUid, memberCount: 1, name: hid });
}

describe('ensureMembershipForCurrentHousehold isDefault exclusivity', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('flags a brand-new membership as default', async () => {
    mockStore.set('households/hh-a', { ownerUid: uid, memberCount: 1, name: 'A' });
    await ensureMembershipForCurrentHousehold(uid, 'hh-a');
    const memberships = await getUserMemberships(uid);
    expect(memberships).toEqual([
      expect.objectContaining({ householdId: 'hh-a', isDefault: true }),
    ]);
  });

  it('clears the previous default when switching to an existing membership', async () => {
    seedMembership('hh-a', true);
    seedMembership('hh-b', false);

    // Switch B -> A is simulated by calling ensureMembership for A while
    // B still (incorrectly, pre-fix) holds isDefault:true.
    await ensureMembershipForCurrentHousehold(uid, 'hh-b');

    const memberships = await getUserMemberships(uid);
    const byId = Object.fromEntries(memberships.map((m) => [m.householdId, m.isDefault]));
    expect(byId).toEqual({ 'hh-a': false, 'hh-b': true });
  });

  it('stays exclusive across repeated back-and-forth switches', async () => {
    seedMembership('hh-a', true);
    seedMembership('hh-b', false);

    await ensureMembershipForCurrentHousehold(uid, 'hh-b'); // A -> B
    await ensureMembershipForCurrentHousehold(uid, 'hh-a'); // B -> A
    await ensureMembershipForCurrentHousehold(uid, 'hh-b'); // A -> B again

    const memberships = await getUserMemberships(uid);
    const defaults = memberships.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].householdId).toBe('hh-b');
  });

  it('lets the delete/leave fallback correctly resolve the real active household after deleting a non-active one', async () => {
    seedMembership('hh-a', true);
    seedMembership('hh-b', false);
    seedMembership('hh-c', false);

    // User's real path: started on A, switched to B, then to C — C is
    // the genuinely active household by the time hh-a gets deleted.
    await ensureMembershipForCurrentHousehold(uid, 'hh-b');
    await ensureMembershipForCurrentHousehold(uid, 'hh-c');

    // hh-a (not the active one) is deleted/left — households.tsx's
    // performDelete and leaveHousehold both do this exact lookup to
    // pick the next active household from whatever remains.
    const remaining = (await getUserMemberships(uid)).filter((m) => m.householdId !== 'hh-a');
    const next = remaining.find((m) => m.isDefault) ?? remaining[0];

    // Pre-fix, ensureMembershipForCurrentHousehold's early `if
    // (snap.exists) return` meant switching to an EXISTING membership
    // (hh-b, hh-c) never actually flagged it isDefault, leaving hh-a's
    // original flag as the only true one — the fallback would have
    // wrongly resolved to hh-a's sibling instead of the real active
    // household, hh-c.
    expect(next.householdId).toBe('hh-c');
  });
});
