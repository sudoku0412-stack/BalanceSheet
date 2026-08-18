const COMMON_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'aol.com',
  'proton.me',
];

const MAX_SUGGESTIONS = 4;

/**
 * Given whatever the user has typed so far in an email field, returns
 * up to MAX_SUGGESTIONS full-address completions from common domains —
 * e.g. "abc@" -> ["abc@gmail.com", "abc@yahoo.com", ...], "abc@gm" ->
 * ["abc@gmail.com"]. Returns [] once the domain looks complete (has a
 * '.') or there's no '@' yet, so suggestions only show in the narrow
 * window where they're actually useful.
 */
export function suggestEmailCompletions(input: string): string[] {
  const at = input.indexOf('@');
  if (at === -1) return [];
  const local = input.slice(0, at);
  if (!local) return [];
  const domainSoFar = input.slice(at + 1).toLowerCase();
  if (domainSoFar.includes('.')) return [];
  const matches = domainSoFar
    ? COMMON_EMAIL_DOMAINS.filter((d) => d.startsWith(domainSoFar))
    : COMMON_EMAIL_DOMAINS;
  return matches.slice(0, MAX_SUGGESTIONS).map((d) => `${local}@${d}`);
}
