import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOrganization } from '../contexts/OrganizationContext';
import { getOrganizationReleaseCalendar, OrgReleaseCalendarItem } from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import {
  CALENDAR_VIEW_MODES,
  CalendarViewMode,
  formatContentTypeLabel,
  RELEASE_STATUS_FILTERS,
  RELEASE_STATUS_STYLES,
  ReleaseStatusFilter,
} from '../constants/releaseCalendar';

interface CalendarSectionProps {
  onUpload?: () => void;
}

function statusForItem(item: OrgReleaseCalendarItem) {
  return RELEASE_STATUS_STYLES[item.calendar_status];
}

function ReleaseCard({ item, compact = false }: { item: OrgReleaseCalendarItem; compact?: boolean }) {
  const style = statusForItem(item);
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card',
        compact ? 'px-3 py-2' : 'p-3'
      )}
    >
      <div className="flex items-start gap-3">
        {item.cover_url ? (
          <img src={item.cover_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
            {item.stage_name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{item.title}</p>
          <p className="truncate text-xs text-muted-foreground">{item.stage_name}</p>
          {!compact && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatContentTypeLabel(item.content_type)}
            </p>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            style.badge
          )}
        >
          {style.label}
        </span>
      </div>
    </div>
  );
}

export function CalendarSection({ onUpload }: CalendarSectionProps) {
  const { organization, artistProfileId, hasPermission } = useOrganization();
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [statusFilter, setStatusFilter] = useState<ReleaseStatusFilter>('all');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [items, setItems] = useState<OrgReleaseCalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(cursorDate, { weekStartsOn: 1 });
      const end = addDays(endOfWeek(cursorDate, { weekStartsOn: 1 }), 1);
      return { start, end };
    }
    if (viewMode === 'agenda') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = addDays(start, 90);
      return { start, end };
    }
    const start = startOfWeek(startOfMonth(cursorDate), { weekStartsOn: 1 });
    const end = addDays(endOfWeek(endOfMonth(cursorDate), { weekStartsOn: 1 }), 1);
    return { start, end };
  }, [cursorDate, viewMode]);

  useEffect(() => {
    if (!organization?.id) return;
    setLoading(true);
    setError(null);
    getOrganizationReleaseCalendar(organization.id, {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      status: statusFilter,
      artistProfileId: artistProfileId,
    })
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load calendar'))
      .finally(() => setLoading(false));
  }, [organization?.id, range.start, range.end, statusFilter, artistProfileId]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, OrgReleaseCalendarItem[]>();
    for (const item of items) {
      const key = format(parseISO(item.scheduled_at), 'yyyy-MM-dd');
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [items]);

  const upcoming = useMemo(() => {
    const now = new Date();
    const horizon = addDays(now, 7);
    return items
      .filter((item) => {
        const d = parseISO(item.scheduled_at);
        return d >= now && d <= horizon;
      })
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      .slice(0, 10);
  }, [items]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursorDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursorDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursorDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursorDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [cursorDate]);

  if (!hasPermission('content.view')) {
    return <p className="text-muted-foreground">You don&apos;t have permission to view the release calendar.</p>;
  }

  const periodLabel =
    viewMode === 'month'
      ? format(cursorDate, 'MMMM yyyy')
      : viewMode === 'week'
        ? `${format(weekDays[0], 'MMM d')} – ${format(weekDays[6], 'MMM d, yyyy')}`
        : 'Upcoming releases';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Release Calendar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drafts, scheduled drops, and published releases across your roster
          </p>
        </div>
        {hasPermission('content.upload') && onUpload && (
          <button
            type="button"
            onClick={onUpload}
            className="rounded-xl bg-[#3ba208] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#3ba208]/90"
          >
            Upload release
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-border bg-card p-1">
          {CALENDAR_VIEW_MODES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewMode(id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                viewMode === id
                  ? 'bg-[#3ba208] text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {viewMode !== 'agenda' && (
          <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-1">
            <button
              type="button"
              onClick={() =>
                setCursorDate((d) => (viewMode === 'month' ? subMonths(d, 1) : addDays(d, -7)))
              }
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Previous period"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[140px] text-center text-sm font-semibold text-foreground">
              {periodLabel}
            </span>
            <button
              type="button"
              onClick={() =>
                setCursorDate((d) => (viewMode === 'month' ? addMonths(d, 1) : addDays(d, 7)))
              }
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Next period"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {RELEASE_STATUS_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setStatusFilter(id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition',
              statusFilter === id
                ? 'border-[#3ba208]/40 bg-[#3ba208]/10 text-[#3ba208]'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center">
          <LoadingLogo />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium text-foreground">Your release calendar is clear</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload content or schedule a release to see it here.
          </p>
          {hasPermission('content.upload') && onUpload && (
            <button
              type="button"
              onClick={onUpload}
              className="mt-4 rounded-xl bg-[#3ba208] px-4 py-2 text-sm font-bold text-white hover:bg-[#3ba208]/90"
            >
              Schedule release
            </button>
          )}
        </div>
      ) : (
        <>
          {viewMode === 'month' && (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <div key={d} className="px-2 py-3">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthDays.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dayItems = itemsByDay.get(key) ?? [];
                  return (
                    <div
                      key={key}
                      className={cn(
                        'min-h-[100px] border-b border-r border-border p-2 last:border-r-0',
                        !isSameMonth(day, cursorDate) && 'bg-muted/20'
                      )}
                    >
                      <div
                        className={cn(
                          'mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                          isToday(day) && 'bg-[#3ba208] text-white',
                          !isToday(day) && 'text-foreground'
                        )}
                      >
                        {format(day, 'd')}
                      </div>
                      <div className="space-y-1">
                        {dayItems.slice(0, 3).map((item) => (
                          <div key={item.id} className="flex items-center gap-1.5 truncate text-[11px]">
                            <span
                              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusForItem(item).dot)}
                            />
                            <span className="truncate text-foreground">{item.title}</span>
                          </div>
                        ))}
                        {dayItems.length > 3 && (
                          <p className="text-[10px] text-muted-foreground">+{dayItems.length - 3} more</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === 'week' && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
              {weekDays.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayItems = itemsByDay.get(key) ?? [];
                return (
                  <div key={key} className="rounded-2xl border border-border bg-card p-3">
                    <div className="mb-3 border-b border-border pb-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {format(day, 'EEE')}
                      </p>
                      <p className={cn('text-lg font-bold', isToday(day) ? 'text-[#3ba208]' : 'text-foreground')}>
                        {format(day, 'd')}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {dayItems.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No releases</p>
                      ) : (
                        dayItems.map((item) => (
                          <div key={item.id} className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className={cn('h-2 w-2 rounded-full', statusForItem(item).dot)} />
                              <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{item.stage_name}</p>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
                              {statusForItem(item).label}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'agenda' && (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
                  <div className="min-w-[120px] text-sm font-semibold text-foreground">
                    {format(parseISO(item.scheduled_at), 'MMM d, yyyy')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <ReleaseCard item={item} compact />
                  </div>
                </div>
              ))}
            </div>
          )}

          {upcoming.length > 0 && viewMode !== 'agenda' && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Upcoming (next 7 days)</h3>
              <div className="mt-4 space-y-3">
                {upcoming.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
                  >
                    <span className="text-sm font-medium text-muted-foreground">
                      {format(parseISO(item.scheduled_at), 'MMM d')}
                    </span>
                    <span className="text-sm text-foreground">
                      {item.title} ({formatContentTypeLabel(item.content_type)})
                    </span>
                    <span className="text-sm text-muted-foreground">— {item.stage_name}</span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase',
                        statusForItem(item).badge
                      )}
                    >
                      {statusForItem(item).label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
