export type ContentReleaseAction = 'draft' | 'schedule' | 'publish';

export interface ConsoleUploadEmbed {
  /** Hide full-screen consumer chrome (header + step nav). */
  hideChrome?: boolean;
  /** Notify parent wizard when the embedded form step changes (0–2). */
  onStepChange?: (step: number) => void;
  /** Called when user goes back from the first embedded form step. */
  onExitFirstStep?: () => void;
  /** Show Save Draft / Schedule / Publish actions on the final step. */
  showReleaseActions?: boolean;
  /** Track title for org activity logging. */
  onTitleChange?: (title: string) => void;
}

export function resolveContentUploadStatus(
  action: ContentReleaseAction,
  releaseDate?: Date | null
): 'pending' | 'approved' {
  if (action === 'draft') return 'pending';
  if (action === 'schedule') return 'pending';
  if (action === 'publish') return 'approved';
  if (releaseDate && releaseDate.getTime() > Date.now()) return 'pending';
  return 'approved';
}

export function generateIsrc(countryCode = 'NG'): string {
  const year = new Date().getFullYear().toString().slice(-2);
  const seq = Math.floor(Math.random() * 99_999)
    .toString()
    .padStart(5, '0');
  return `${countryCode.toUpperCase()}-APL-${year}-${seq}`;
}

export interface ContentCredit {
  role: string;
  name: string;
}
