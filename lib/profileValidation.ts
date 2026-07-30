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
  if (!firstName) errors.firstName = 'Name is required.';
  else if (firstName.length > MAX_NAME_LEN) errors.firstName = `Keep it under ${MAX_NAME_LEN} characters.`;

  const lastName = draft.lastName.trim();
  if (lastName.length > MAX_NAME_LEN) errors.lastName = `Keep it under ${MAX_NAME_LEN} characters.`;

  return errors;
}

export function isProfileValidationClean(errors: ProfileValidationError): boolean {
  return Object.keys(errors).length === 0;
}
