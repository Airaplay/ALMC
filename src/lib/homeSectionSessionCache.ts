const MAX_ENTRIES = 48;
const sessions = new Map<string, unknown>();

export function readHomeSectionSession<T>(key: string): T | null {
  const value = sessions.get(key);
  return value != null ? (value as T) : null;
}

export function writeHomeSectionSession<T>(key: string, value: T): void {
  if (sessions.size >= MAX_ENTRIES && !sessions.has(key)) {
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }
  sessions.set(key, value);
}

export function hasHomeSectionSession(key: string): boolean {
  const value = sessions.get(key);
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
