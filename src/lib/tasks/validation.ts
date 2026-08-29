/**
 * Validates whether a given string is a valid IANA timezone name.
 * Uses Intl.DateTimeFormat under the hood. Fallback to UTC if invalid.
 */
export function isValidTimezone(tz?: string | null): boolean {
  if (!tz || typeof tz !== 'string' || !tz.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

export function sanitizeTimezone(tz?: string | null, fallback = 'UTC'): string {
  if (isValidTimezone(tz)) {
    return tz!.trim();
  }
  return fallback;
}
