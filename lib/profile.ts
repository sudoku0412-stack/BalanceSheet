import {
  ProfileRow,
  deleteProfileRow,
  getProfileRow,
  upsertProfileRow,
} from './database';
import {
  ProfileDraft,
  ProfileValidationError,
  isProfileValidationClean,
  validateProfileDraft,
} from './profileValidation';

export type { ProfileDraft, ProfileValidationError } from './profileValidation';
export {
  MAX_NAME_LEN,
  isProfileValidationClean,
  validateProfileDraft,
} from './profileValidation';

export type Profile = {
  uid: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt: string;
};

export function rowToProfile(row: ProfileRow): Profile {
  return {
    uid: row.uid,
    firstName: row.first_name,
    lastName: row.last_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProfile(uid: string): Promise<Profile | null> {
  const row = await getProfileRow(uid);
  return row ? rowToProfile(row) : null;
}

export async function saveProfile(
  uid: string,
  draft: ProfileDraft,
  existing: Profile | null,
): Promise<Profile> {
  const errors: ProfileValidationError = validateProfileDraft(draft);
  if (!isProfileValidationClean(errors)) {
    throw new Error('Profile draft is invalid. Validate before saving.');
  }
  const now = new Date().toISOString();
  const row: ProfileRow = {
    uid,
    first_name: draft.firstName.trim(),
    last_name: draft.lastName.trim(),
    created_at: existing?.createdAt ?? now,
    updated_at: now,
  };
  await upsertProfileRow(row);
  return rowToProfile(row);
}

export async function deleteProfile(uid: string): Promise<void> {
  await deleteProfileRow(uid);
}
