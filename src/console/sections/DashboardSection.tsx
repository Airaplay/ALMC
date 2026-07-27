import { useEffect, useMemo, useState } from 'react';
import { X, Download, TrendingUp, TrendingDown, Minus, Headphones } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useOrganization } from '../contexts/OrganizationContext';
import { getOrganizationDashboard, OrgDashboardData } from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import {
  Users,
  Play,
  Heart,
  DollarSign,
  Disc3,
  Music,
  Video,
  Activity,
  Layers,
} from 'lucide-react';
import {
  formatOrgActivityMessage,
  formatRelativeTime,
  pctChange,
} from '../utils/formatOrgActivity';
import { exportDashboardCsv } from '../utils/exportDashboardCsv';
import { consoleTheme } from '../consoleTheme';

const PERIOD_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
] as const;

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatRevenueUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const delta = pctChange(current, previous);
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        —
      </span>
    );
  }

  const positive = delta >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        positive ? 'text-[var(--almc-lime-deep)]' : 'text-red-400'
      }`}
    >
      <Icon className="h-3 w-3" />
      {positive ? '+' : ''}
      {delta}%
    </span>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  sublabel,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
  delta?: { current: number; previous: number } | null;
  sublabel?: string;
}) {
  return (
    <div className={`${consoleTheme.card} p-5`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className={consoleTheme.label}>{label}</span>
        <div className={consoleTheme.iconWell}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>
      <p className={consoleTheme.display}>{value}</p>
      {(delta || sublabel) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {delta && <DeltaBadge current={delta.current} previous={delta.previous} />}
          {sublabel && <span className="text-xs text-muted-foreground">{sublabel}</span>}
        </div>
      )}
    </div>
  );
}

function chartLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function DashboardSection() {
  const {
    organization,
    artistProfileId,
    selectedArtist,
    setArtistProfileId,
    setSelectedArtist,
  } = useOrganization();
  const [periodDays, setPeriodDays] = useState(30);
  const [data, setData] = useState<OrgDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isArtistFocus = Boolean(artistProfileId && selectedArtist);

  useEffect(() => {
    if (!organization?.id) return;
    setLoading(true);
    setError(null);
    getOrganizationDashboard(organization.id, periodDays)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [organization?.id, periodDays]);

  const chartData = useMemo(
    () =>
      (data?.growth_chart ?? []).map((point) => ({
        ...point,
        label: chartLabel(point.date),
      })),
    [data?.growth_chart]
  );

  const clearFocus = () => {
    setArtistProfileId(null);
    setSelectedArtist(null);
  };

  const artistRank = useMemo(() => {
    if (!selectedArtist || !data?.top_performing_artists?.length) return null;
    const idx = data.top_performing_artists.findIndex(
      (a) => a.artist_profile_id === selectedArtist.artist_profile_id
    );
    return idx >= 0 ? idx + 1 : null;
  }, [data?.top_performing_artists, selectedArtist]);

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <LoadingLogo />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</div>
    );
  }

  if (!data) return null;

  if (isArtistFocus && selectedArtist) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">{selectedArtist.stage_name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Artist performance · last {periodDays} days
            </p>
          </div>
          <button
            type="button"
            onClick={clearFocus}
            className={`${consoleTheme.btnSecondary} h-10 px-4`}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
            View all artists
          </button>
        </div>

        <div className={`flex items-center gap-4 p-4 ${consoleTheme.banner}`}>
          {selectedArtist.profile_photo_url ? (
            <img
              src={selectedArtist.profile_photo_url}
              alt=""
              className="h-14 w-14 rounded-full object-cover ring-2 ring-white"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-card text-lg font-semibold">
              {selectedArtist.stage_name.charAt(0)}
            </div>
          )}
          <div>
            <p className="font-medium text-foreground">{selectedArtist.email}</p>
            {selectedArtist.country && (
              <p className="text-sm text-muted-foreground">{selectedArtist.country}</p>
            )}
            {selectedArtist.latest_release?.title && (
              <p className="mt-1 text-xs text-muted-foreground">
                Latest: {selectedArtist.latest_release.title}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total Streams" value={formatNumber(Number(selectedArtist.streams))} icon={Play} />
          <KpiCard label="Followers" value={formatNumber(Number(selectedArtist.followers))} icon={Heart} />
          <KpiCard label="Revenue" value={formatRevenueUsd(Number(selectedArtist.revenue))} icon={DollarSign} />
          <KpiCard
            label="Org rank (period)"
            value={artistRank ? `#${artistRank}` : '—'}
            icon={Activity}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Organization-wide performance · last {periodDays} days
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
            className={consoleTheme.select}
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => organization && exportDashboardCsv(data, organization.name)}
            className={`${consoleTheme.btnSecondary} h-10 px-4`}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Artists"
          value={data.total_artists}
          icon={Users}
          sublabel={data.artists_added > 0 ? `+${data.artists_added} this period` : undefined}
        />
        <KpiCard
          label="Streams"
          value={formatNumber(Number(data.period_streams))}
          icon={Play}
          delta={{
            current: Number(data.period_streams),
            previous: Number(data.previous_period_streams),
          }}
        />
        <KpiCard label="Followers" value={formatNumber(Number(data.total_followers))} icon={Heart} />
        <KpiCard
          label="Revenue"
          value={formatRevenueUsd(Number(data.period_revenue))}
          icon={DollarSign}
          delta={{
            current: Number(data.period_revenue),
            previous: Number(data.previous_period_revenue),
          }}
          sublabel={`${formatRevenueUsd(Number(data.total_revenue))} lifetime`}
        />
        <KpiCard label="Releases" value={data.total_releases} icon={Layers} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Albums" value={data.total_albums} icon={Disc3} />
        <KpiCard label="Songs" value={data.total_songs} icon={Music} />
        <KpiCard label="Videos" value={data.total_videos} icon={Video} />
        <KpiCard label="Campaigns" value={0} icon={Activity} sublabel="Coming in Phase 3" />
        <KpiCard
          label="Listeners"
          value={formatNumber(Number(data.period_listeners))}
          icon={Headphones}
          delta={{
            current: Number(data.period_listeners),
            previous: Number(data.previous_period_listeners),
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${consoleTheme.card} p-5`}>
          <h3 className={consoleTheme.label}>Streams &amp; listener growth</h3>
          <p className="mt-1.5 text-xs text-muted-foreground">Daily activity over the selected period</p>
          <div className="mt-4 h-64">
            {chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground/80">
                No playback data in this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="orgStreamsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#33AA2D" stopOpacity={0.55} />
                      <stop offset="95%" stopColor="#33AA2D" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="orgListenersFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#000000" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#000000" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '20px',
                      fontSize: 12,
                      boxShadow: 'none',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="streams"
                    name="Streams"
                    stroke="#33AA2D"
                    fill="url(#orgStreamsFill)"
                    strokeWidth={2.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="listeners"
                    name="Listeners"
                    stroke="#000000"
                    fill="url(#orgListenersFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className={`${consoleTheme.card} p-5`}>
          <h3 className={consoleTheme.label}>Top performing artists</h3>
          <p className="mt-1.5 text-xs text-muted-foreground">By streams in the selected period</p>
          {(data.top_performing_artists ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground/80">No artists linked yet</p>
          ) : (
            <ol className="mt-4 space-y-2.5">
              {data.top_performing_artists.map((artist, index) => (
                <li
                  key={artist.artist_profile_id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-secondary/60 px-3.5 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--almc-lime)] text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <span className="truncate font-medium text-foreground">{artist.stage_name}</span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {formatNumber(Number(artist.streams))}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {data.fastest_growing_artist && (
            <p className={`mt-4 px-3.5 py-2.5 text-sm ${consoleTheme.banner}`}>
              Fastest growing:{' '}
              <span className="font-semibold text-foreground">
                {data.fastest_growing_artist.stage_name}
              </span>{' '}
              (+{data.fastest_growing_artist.growth_pct}%)
            </p>
          )}
        </div>
      </div>

      <div className={`${consoleTheme.card} p-5`}>
        <h3 className={consoleTheme.label}>Recent activity</h3>
        <ul className="mt-4 space-y-3">
          {(data.recent_activity ?? []).length === 0 ? (
            <li className="text-sm text-muted-foreground/80">No recent activity</li>
          ) : (
            data.recent_activity.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 border-b border-border/60 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm text-foreground">{formatOrgActivityMessage(item)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(item.created_at)}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
