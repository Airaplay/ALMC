import { Disc3, Mic2, Music, RefreshCw, Video } from 'lucide-react';

export const CONTENT_WIZARD_STEPS = ['Artist', 'Type', 'Files', 'Metadata', 'Review'] as const;

export type ContentWizardStepIndex = 0 | 1 | 2 | 3 | 4;

export type ContentUploadType = 'single' | 'album' | 'video';

export const CONTENT_UPLOAD_TYPES: Array<{
  id: ContentUploadType | 'podcast' | 'loop';
  label: string;
  detail: string;
  icon: typeof Music;
  enabled: boolean;
  badge?: string;
}> = [
  { id: 'single', label: 'Single', detail: 'One track release', icon: Music, enabled: true },
  { id: 'album', label: 'Album / EP', detail: 'Multi-track project', icon: Disc3, enabled: true },
  { id: 'video', label: 'Music Video', detail: 'Video release', icon: Video, enabled: true },
  {
    id: 'podcast',
    label: 'Podcast',
    detail: 'Coming in Phase 3',
    icon: Mic2,
    enabled: false,
    badge: 'Phase 3',
  },
  {
    id: 'loop',
    label: 'Loop',
    detail: 'Coming in Phase 3',
    icon: RefreshCw,
    enabled: false,
    badge: 'Phase 3',
  },
];

export const CONTENT_TYPE_LABELS: Record<ContentUploadType, string> = {
  single: 'Single',
  album: 'Album / EP',
  video: 'Music Video',
};

/** Map embedded upload form steps (0–2) to wizard steps 3–5. */
export function formStepToWizardStep(formStep: number): ContentWizardStepIndex {
  return Math.min(4, formStep + 2) as ContentWizardStepIndex;
}
