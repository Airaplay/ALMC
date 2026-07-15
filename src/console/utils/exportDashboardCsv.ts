import { OrgDashboardData } from '../../lib/orgAccess';

function escapeCsv(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function exportDashboardCsv(data: OrgDashboardData, orgName: string): void {
  const rows: string[] = [
    `Organization,${escapeCsv(orgName)}`,
    `Period (days),${data.period_days}`,
    `Period start,${data.period_start}`,
    `Period end,${data.period_end}`,
    '',
    'Metric,Value',
    `Total artists,${data.total_artists}`,
    `Artists added (period),${data.artists_added}`,
    `Period streams,${data.period_streams}`,
    `Previous period streams,${data.previous_period_streams}`,
    `Period listeners,${data.period_listeners}`,
    `Previous period listeners,${data.previous_period_listeners}`,
    `Total followers,${data.total_followers}`,
    `Period revenue (USD),${data.period_revenue}`,
    `Previous period revenue (USD),${data.previous_period_revenue}`,
    `Total revenue (USD),${data.total_revenue}`,
    `Total releases,${data.total_releases}`,
    `Albums,${data.total_albums}`,
    `Songs,${data.total_songs}`,
    `Videos,${data.total_videos}`,
    '',
    'Top artists (period streams),Streams',
    ...data.top_performing_artists.map(
      (a) => `${escapeCsv(a.stage_name)},${a.streams}`
    ),
    '',
    'Date,Streams,Listeners',
    ...data.growth_chart.map(
      (d) => `${d.date},${d.streams},${d.listeners}`
    ),
  ];

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${orgName.replace(/\s+/g, '-').toLowerCase()}-dashboard-${data.period_days}d.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
