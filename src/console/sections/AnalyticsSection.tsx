import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOrganization } from '../contexts/OrganizationContext';
import { getOrganizationAnalytics, OrgAnalyticsData } from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import { pctChange } from '../utils/formatOrgActivity';
import { exportAnalyticsCsv } from '../utils/exportAnalyticsCsv';

type AnalyticsTab = 'streams' | 'listeners' | 'revenue' | 'retention' | 'demographics';
type ScopeMode = 'org' | 'artist';

const PERIOD_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
] as const;

const TABS: Array<{ id: AnalyticsTab; label: string }> = [
  { id: 'streams', label: 'Streams' },
  { id: 'listeners', label: 'Listeners' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'retention', label: 'Retention' },
  { id: 'demographics', label: 'Demographics' },
];

const PIE_COLORS = ['#3ba208', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#94a3b8'];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const delta = pctChange(current, previous);
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> —
      </span>
    );
  }
  const positive = delta >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', positive ? 'text-[#3ba208]' : 'text-red-400')}>
      <Icon className="h-3 w-3" />
      {positive ? '+' : ''}
      {delta}%
    </span>
  );
}

function chartLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function AnalyticsSection() {
  const { organization, artistProfileId, selectedArtist, hasPermission, setArtistProfileId, setSelectedArtist } =
    useOrganization();
  const [days, setDays] = useState(30);
  const [scope, setScope] = useState<ScopeMode>(artistProfileId ? 'artist' : 'org');
  const [tab, setTab] = useState<AnalyticsTab>('streams');
  const [data, setData] = useState<OrgAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (artistProfileId) setScope('artist');
  }, [artistProfileId]);

  useEffect(() => {
    if (!organization?.id) return;
    if (scope === 'artist' && !artistProfileId) {
      setData(null);
      setLoading(false);
      setError('Select an artist in the switcher for per-artist analytics.');
      return;
    }
    setLoading(true);
    setError(null);
    getOrganizationAnalytics(organization.id, {
      days,
      artistProfileId: scope === 'artist' ? artistProfileId : null,
    })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [organization?.id, days, scope, artistProfileId]);

  const chartData = useMemo(
    () =>
      (data?.streams_by_day ?? []).map((d) => ({
        ...d,
        label: chartLabel(d.date),
      })),
    [data]
  );

  const genderPie = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data?.age_gender ?? []) {
      const key = row.gender ?? 'unknown';
      map.set(key, (map.get(key) ?? 0) + (row.listeners ?? 0));
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [data]);

  if (!hasPermission('analytics.view')) {
    return <p className="text-muted-foreground">You don&apos;t have permission to view analytics.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Analytics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Organization overview with period comparison
            {scope === 'artist' && selectedArtist ? ` · ${selectedArtist.stage_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3ba208]/30 bg-[#3ba208]/10 px-2.5 py-1 text-[11px] font-semibold text-[#3ba208]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3ba208]" />
            Live data
          </span>
          {data && organization && (
            <button
              type="button"
              onClick={() => exportAnalyticsCsv(data, organization.name)}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => {
              setScope('org');
              setArtistProfileId(null);
              setSelectedArtist(null);
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium',
              scope === 'org' ? 'bg-[#3ba208] text-white' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Org-wide
          </button>
          <button
            type="button"
            onClick={() => setScope('artist')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium',
              scope === 'artist' ? 'bg-[#3ba208] text-white' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Per Artist
          </button>
        </div>

        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">Compare: previous period</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-semibold',
              tab === id
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
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">{error}</div>
      ) : !data ? null : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
              {(tab === 'streams' || tab === 'listeners') && (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Streams</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                        {formatNumber(data.period_streams)}
                      </p>
                      <Delta current={data.period_streams} previous={data.previous_period_streams} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Listeners</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                        {formatNumber(data.period_listeners)}
                      </p>
                      <Delta current={data.period_listeners} previous={data.previous_period_listeners} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg completion</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                        {data.avg_completion}%
                      </p>
                    </div>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: '#141416', border: '1px solid #2a2a2e', borderRadius: 12 }}
                        />
                        <Bar
                          dataKey={tab === 'listeners' ? 'listeners' : 'streams'}
                          fill="#3ba208"
                          radius={[6, 6, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}

              {tab === 'revenue' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Period revenue (ads)</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                      {formatUsd(data.period_revenue)}
                    </p>
                    <Delta current={data.period_revenue} previous={data.previous_period_revenue} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Previous period</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                      {formatUsd(data.previous_period_revenue)}
                    </p>
                  </div>
                </div>
              )}

              {tab === 'retention' && (
                <div>
                  <p className="text-xs text-muted-foreground">Average completion rate</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{data.avg_completion}%</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Share of track duration listeners typically complete in this period.
                  </p>
                </div>
              )}

              {tab === 'demographics' && (
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="h-56">
                    {genderPie.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No demographic data yet</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={genderPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                            {genderPie.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(data.age_gender ?? []).slice(0, 8).map((row, i) => (
                      <div key={`${row.gender}-${row.age_bucket}-${i}`} className="flex justify-between text-sm">
                        <span className="capitalize text-muted-foreground">
                          {(row.gender ?? 'unknown').replace('_', ' ')} · {(row.age_bucket ?? 'unknown').replace('_', '-')}
                        </span>
                        <span className="tabular-nums text-foreground">{formatNumber(row.listeners ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground">Top Countries</h3>
                <div className="mt-3 space-y-2">
                  {(data.top_countries ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No country data yet</p>
                  ) : (
                    data.top_countries.map((c) => (
                      <div key={c.country} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{c.country}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {c.pct ?? 0}% · {formatNumber(c.streams ?? 0)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground">Devices</h3>
                <div className="mt-3 space-y-2">
                  {(data.devices ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No device data yet</p>
                  ) : (
                    data.devices.map((d) => (
                      <div key={d.device} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{d.device}</span>
                        <span className="tabular-nums text-muted-foreground">{d.pct ?? 0}%</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Top Songs</h3>
              <div className="mt-3 space-y-3">
                {(data.top_songs ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No song plays yet</p>
                ) : (
                  data.top_songs.slice(0, 5).map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{s.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.stage_name}</p>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{formatNumber(s.streams)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Top Albums</h3>
              <div className="mt-3 space-y-3">
                {(data.top_albums ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No album plays yet</p>
                ) : (
                  data.top_albums.slice(0, 5).map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{a.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{a.stage_name}</p>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{formatNumber(a.streams)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Growth Comparison</h3>
              <div className="mt-3 space-y-3">
                {(data.growth_comparison ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No artist growth data yet</p>
                ) : (
                  data.growth_comparison.slice(0, 5).map((a) => (
                    <div key={a.artist_profile_id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{a.stage_name}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(a.period_streams)} streams</p>
                      </div>
                      <span
                        className={cn(
                          'tabular-nums text-xs font-semibold',
                          a.growth_pct >= 0 ? 'text-[#3ba208]' : 'text-red-400'
                        )}
                      >
                        {a.growth_pct >= 0 ? '+' : ''}
                        {a.growth_pct}%
                      </span>
                    </div>
                  ))
                )}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Playlist placements & traffic sources arrive in a later analytics pass.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
