/**
 * Safe escaping for values used in Supabase/PostgREST filter strings.
 * Use when building .or() or filter strings that embed user input to prevent injection.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Escape a string for safe use inside a PostgREST filter predicate value.
 * Prevents breaking out of the value and SQL injection via .or("col.ilike.%"+x+"%").
 */
export function sanitizeForFilter(value: string, maxLength = 200): string {
  if (typeof value !== 'string') return '';
  let s = value.slice(0, maxLength);
  // Escape backslash first, then single quote (SQL-style)
  s = s.replace(/\\/g, '\\\\').replace(/'/g, "''");
  // Remove characters that could break PostgREST predicate parsing
  s = s.replace(/[,().]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Return true if the string looks like a valid UUID (for use in filter strings).
 */
export function isValidUUID(id: string | null | undefined): boolean {
  if (id == null || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}
