import { OrgAnalyticsData } from '../../lib/orgAccess';

function escapeCsv(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function exportAnalyticsCsv(data: OrgAnalyticsData, orgName: string): void {
  const rows: string[] = [
    `Organization,${escapeCsv(orgName)}`,
    `Period (days),${data.period_days}`,
    `Scope,${data.artist_profile_id ? 'Per artist' : 'Org-wide'}`,
    '',
    'Metric,Current,Previous',
    `Streams,${data.period_streams},${data.previous_period_streams}`,
    `Listeners,${data.period_listeners},${data.previous_period_listeners}`,
    `Revenue (USD),${data.period_revenue},${data.previous_period_revenue}`,
    `Avg completion %,${data.avg_completion},`,
    '',
    'Date,Streams,Listeners',
    ...data.streams_by_day.map((d) => `${d.date},${d.streams},${d.listeners}`),
    '',
    'Country,Streams,Pct',
    ...data.top_countries.map(
      (c) => `${escapeCsv(c.country ?? 'Unknown')},${c.streams ?? 0},${c.pct ?? 0}`
    ),
    '',
    'Song,Artist,Streams',
    ...data.top_songs.map(
      (s) => `${escapeCsv(s.title)},${escapeCsv(s.stage_name)},${s.streams}`
    ),
    '',
    'Album,Artist,Streams',
    ...data.top_albums.map(
      (a) => `${escapeCsv(a.title)},${escapeCsv(a.stage_name)},${a.streams}`
    ),
  ];

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${orgName.replace(/\s+/g, '-').toLowerCase()}-analytics-${data.period_days}d.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
