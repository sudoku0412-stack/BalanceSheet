import { tr } from './i18n';
export type ProfileDraft = {
  firstName: string;
  lastName: string;
};

export type ProfileValidationError = {
  firstName?: string;
  lastName?: string;
};

export const MAX_NAME_LEN = 40;

export function validateProfileDraft(draft: ProfileDraft): ProfileValidationError {
  const errors: ProfileValidationError = {};
  const firstName = draft.firstName.trim();
  if (!firstName) errors.firstName = tr('nameRequired2');
  else if (firstName.length > MAX_NAME_LEN) errors.firstName = tr('keepUnderChars', { max: MAX_NAME_LEN });

  const lastName = draft.lastName.trim();
  if (lastName.length > MAX_NAME_LEN) errors.lastName = tr('keepUnderChars', { max: MAX_NAME_LEN });

  return errors;
}

export function isProfileValidationClean(errors: ProfileValidationError): boolean {
  return Object.keys(errors).length === 0;
}
