/** Time-of-day greeting for ALMC console. */

export function getTimeOfDayGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export type ConsoleGreetingParts = {
  /** e.g. "Hi Airaplay" — lighter line above the time greeting */
  hiLine: string | null;
  /** e.g. "Good afternoon" — primary headline */
  timeGreeting: string;
};

export function getConsoleGreetingParts(
  organizationName: string | null | undefined,
  date = new Date()
): ConsoleGreetingParts {
  const timeGreeting = getTimeOfDayGreeting(date);
  const name = (organizationName ?? '').trim();
  return {
    hiLine: name ? `Hi ${name}` : null,
    timeGreeting,
  };
}
