export type ContactsModule = typeof import('expo-contacts');

/** expo-contacts is a native module — the current installed binary on
 *  a device may predate this feature and not have it linked yet (needs
 *  `pod install` + a fresh Xcode rebuild, same as expo-camera/expo-
 *  notifications before it — see HANDOVER.md). A top-level `import` of
 *  expo-contacts resolves the native module as soon as ANY screen that
 *  imports this file loads, crashing outright on an un-rebuilt binary.
 *  Lazy-require it instead, mirroring lib/cloudSync.ts's
 *  loadFirestore/loadStorage pattern, so the app stays usable and any
 *  contacts feature just no-ops until rebuilt. Shared by
 *  lib/contactPicker.ts (single-pick) and lib/contactsSync.ts (full
 *  sync) so both hit the same cache instead of loading the module
 *  twice. */
let cachedContacts: ContactsModule | null | undefined;

export function loadContacts(): ContactsModule | null {
  if (cachedContacts !== undefined) return cachedContacts;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    cachedContacts = require('expo-contacts') as ContactsModule;
  } catch {
    cachedContacts = null;
  }
  return cachedContacts;
}
