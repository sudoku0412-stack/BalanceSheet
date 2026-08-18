import { Platform } from 'react-native';
import { normalizePhoneE164 } from './phone';
import { loadContacts } from './expoContacts';

export type PickedContact = {
  name: string;
  phoneE164: string;
};

/** True once expo-contacts' native module is actually linked — lets
 *  callers hide/disable the "Add by phone" button instead of letting
 *  the user tap into a guaranteed no-op. */
export function isContactPickerAvailable(): boolean {
  return loadContacts() !== null;
}

/** Opens the OS's native contact picker. iOS needs no permission grant
 *  for this (the picker itself only ever exposes the one contact the
 *  user taps); Android's picker intent does require READ_CONTACTS
 *  first. Returns null if the native module isn't linked yet, the user
 *  cancels, the Android permission is denied, or the picked contact has
 *  no usable phone number. */
export async function pickContactWithPhone(): Promise<PickedContact | null> {
  const Contacts = loadContacts();
  if (!Contacts) return null;
  if (Platform.OS === 'android') {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') return null;
  }
  const contact = await Contacts.presentContactPickerAsync();
  if (!contact) return null;
  const rawNumber = contact.phoneNumbers?.[0]?.number;
  if (!rawNumber) return null;
  const e164 = normalizePhoneE164(rawNumber);
  if (!e164) return null;
  return { name: contact.name || 'Contact', phoneE164: e164 };
}
