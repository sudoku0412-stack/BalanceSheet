import { normalizePhoneE164 } from './phone';
import { lookupUserByEmail, lookupUserByPhone } from './cloudSync';
import { loadContacts } from './expoContacts';

export function isContactsSyncAvailable(): boolean {
  return loadContacts() !== null;
}

export type DeviceContact = {
  id: string;
  name: string;
  phones: string[]; // normalized E.164, deduped
  emails: string[]; // lowercased, deduped
};

/** Requests full contacts read access (a real OS permission prompt on
 *  both platforms) and returns every contact that has at least one
 *  usable phone number or email. Returns null if the native module
 *  isn't linked, or the user denies/cancels. */
export async function readAllContacts(): Promise<DeviceContact[] | null> {
  const Contacts = loadContacts();
  if (!Contacts) return null;
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') return null;
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
  });
  const contacts: DeviceContact[] = [];
  for (const c of data) {
    const phones = Array.from(
      new Set(
        (c.phoneNumbers ?? [])
          .map((p) => (p.number ? normalizePhoneE164(p.number) : null))
          .filter((v): v is string => v !== null),
      ),
    );
    const emails = Array.from(
      new Set(
        (c.emails ?? [])
          .map((e) => e.email?.trim().toLowerCase())
          .filter((v): v is string => !!v && v.includes('@')),
      ),
    );
    if (phones.length === 0 && emails.length === 0) continue;
    contacts.push({ id: c.id ?? `${c.name ?? ''}-${phones[0] ?? emails[0]}`, name: c.name || 'Contact', phones, emails });
  }
  return contacts;
}

export type MatchedContact = {
  contact: DeviceContact;
  matchedVia: 'phone' | 'email';
  matchedValue: string;
  uid: string;
  displayName: string | null;
};

export type ContactSyncResult = {
  matched: MatchedContact[];
  unmatched: DeviceContact[];
};

/** Bounds how many lookups run at once — a large contacts list (500+)
 *  would otherwise fire that many concurrent Firestore reads in one
 *  burst. Chunked, not throttled per-request, since each read is cheap
 *  and independent. */
const LOOKUP_CONCURRENCY = 20;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Matches every unique phone/email across all contacts against the
 *  phoneIndex/emailIndex collections, deduping lookups so a value
 *  shared by multiple contacts (or a contact with both a matching
 *  phone AND email) is only read once. Phone match wins over email
 *  when a contact matches on both, since phone drives the existing
 *  no-accept-tap auto-join (lib/phoneInvite.ts) while email still
 *  requires the invitee to accept — phone is the stronger signal. */
export async function matchContacts(contacts: DeviceContact[]): Promise<ContactSyncResult> {
  const uniquePhones = Array.from(new Set(contacts.flatMap((c) => c.phones)));
  const uniqueEmails = Array.from(new Set(contacts.flatMap((c) => c.emails)));

  const [phoneResults, emailResults] = await Promise.all([
    mapWithConcurrency(uniquePhones, LOOKUP_CONCURRENCY, async (phone) => [phone, await lookupUserByPhone(phone)] as const),
    mapWithConcurrency(uniqueEmails, LOOKUP_CONCURRENCY, async (email) => [email, await lookupUserByEmail(email)] as const),
  ]);

  const phoneMatches = new Map(phoneResults.filter(([, m]) => m !== null) as [string, { uid: string; displayName: string | null }][]);
  const emailMatches = new Map(emailResults.filter(([, m]) => m !== null) as [string, { uid: string; displayName: string | null }][]);

  const matched: MatchedContact[] = [];
  const unmatched: DeviceContact[] = [];

  for (const contact of contacts) {
    const phoneHit = contact.phones.find((p) => phoneMatches.has(p));
    if (phoneHit) {
      const m = phoneMatches.get(phoneHit)!;
      matched.push({ contact, matchedVia: 'phone', matchedValue: phoneHit, uid: m.uid, displayName: m.displayName });
      continue;
    }
    const emailHit = contact.emails.find((e) => emailMatches.has(e));
    if (emailHit) {
      const m = emailMatches.get(emailHit)!;
      matched.push({ contact, matchedVia: 'email', matchedValue: emailHit, uid: m.uid, displayName: m.displayName });
      continue;
    }
    unmatched.push(contact);
  }

  return { matched, unmatched };
}

