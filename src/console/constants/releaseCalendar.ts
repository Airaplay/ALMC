export type CalendarViewMode = 'month' | 'week' | 'agenda';

export type ReleaseCalendarStatus = 'draft' | 'scheduled' | 'published' | 'cancelled';

export type ReleaseStatusFilter = 'all' | ReleaseCalendarStatus;

export const CALENDAR_VIEW_MODES: Array<{ id: CalendarViewMode; label: string }> = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'agenda', label: 'Agenda' },
];

export const RELEASE_STATUS_FILTERS: Array<{ id: ReleaseStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'published', label: 'Published' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const RELEASE_STATUS_STYLES: Record<
  ReleaseCalendarStatus,
  { badge: string; dot: string; label: string }
> = {
  draft: {
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400',
    label: 'Draft',
  },
  scheduled: {
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    dot: 'bg-blue-400',
    label: 'Scheduled',
  },
  published: {
    badge: 'bg-[#3ba208]/15 text-[#3ba208] border-[#3ba208]/30',
    dot: 'bg-[#3ba208]',
    label: 'Published',
  },
  cancelled: {
    badge: 'bg-red-500/15 text-red-400 border-red-500/30',
    dot: 'bg-red-400',
    label: 'Cancelled',
  },
};

export function formatContentTypeLabel(type: string): string {
  switch (type) {
    case 'single':
      return 'Single';
    case 'album':
      return 'Album';
    case 'video':
      return 'Video';
    case 'short_clip':
      return 'Loop';
    case 'podcast':
      return 'Podcast';
    default:
      return type.replace(/_/g, ' ');
  }
}
