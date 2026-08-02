import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Shared E.164 normalizer for both the profile "add my phone number"
 *  flow and the (Phase B) contact-picker invite flow, so both write the
 *  exact same format anything else in the app compares against. Returns
 *  null for anything that isn't a plausible phone number. */
export function normalizePhoneE164(raw: string, defaultRegion?: string): string | null {
  const parsed = parsePhoneNumberFromString(raw, defaultRegion as never);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // already E.164, e.g. "+14165551234"
}
