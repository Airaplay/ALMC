/** Time-of-day greeting for ALMC console, e.g. "Hi Jane, Good evening". */

export function getTimeOfDayGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatConsoleGreeting(displayName: string | null | undefined, date = new Date()): string {
  const greeting = getTimeOfDayGreeting(date);
  const name = (displayName ?? '').trim();
  if (!name) return greeting;
  return `Hi ${name}, ${greeting}`;
}

export function firstNameFromDisplay(displayName: string | null | undefined, email?: string | null): string {
  const raw = (displayName ?? '').trim();
  if (raw) return raw.split(/\s+/)[0];
  const fromEmail = (email ?? '').split('@')[0]?.trim();
  return fromEmail || '';
}
