/** Time-of-day greeting for ALMC console, e.g. "Hi Mavin Records, Good evening". */

export function getTimeOfDayGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatConsoleGreeting(organizationName: string | null | undefined, date = new Date()): string {
  const greeting = getTimeOfDayGreeting(date);
  const name = (organizationName ?? '').trim();
  if (!name) return greeting;
  return `Hi ${name}, ${greeting}`;
}
