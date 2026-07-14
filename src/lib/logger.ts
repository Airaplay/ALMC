/**
 * Central logger for errors and warnings. Use instead of console.log for failures.
 * Keeps console.error/warn for stack traces; can be extended for Sentry etc.
 */

export const logger = {
  error(message: string, error?: unknown): void {
    if (error instanceof Error) {
      console.error(`[Error] ${message}`, error.message, error);
    } else {
      console.error(`[Error] ${message}`, error);
    }
  },

  warn(message: string, detail?: unknown): void {
    if (detail !== undefined) {
      console.warn(`[Warn] ${message}`, detail);
    } else {
      console.warn(`[Warn] ${message}`);
    }
  },
};
