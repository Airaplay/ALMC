import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { getOrganizationDashboard, OrgDashboardData } from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import { Users, Play, Heart, DollarSign, Disc3, Music, Video, Activity } from 'lucide-react';

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

function KpiCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="rounded-lg bg-muted p-2">
          <Icon className="h-4 w-4 text-[#3ba208]" />
        </div>
      </div>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function DashboardSection() {
  const {
    organization,
    artistProfileId,
    selectedArtist,
    setArtistProfileId,
    setSelectedArtist,
  } = useOrganization();
  const [data, setData] = useState<OrgDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isArtistFocus = Boolean(artistProfileId && selectedArtist);

  useEffect(() => {
    if (!organization?.id) return;
    setLoading(true);
    getOrganizationDashboard(organization.id)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [organization?.id]);

  const clearFocus = () => {
    setArtistProfileId(null);
    setSelectedArtist(null);
  };

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
            <p className="mt-1 text-sm text-muted-foreground">Artist performance overview</p>
          </div>
          <button
            type="button"
            onClick={clearFocus}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-secondary-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
            View all artists
          </button>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-[#3ba208]/30 bg-[#309605]/10 p-4">
          {selectedArtist.profile_photo_url ? (
            <img
              src={selectedArtist.profile_photo_url}
              alt=""
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-semibold">
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
          <KpiCard label="Streams" value={formatNumber(Number(selectedArtist.streams))} icon={Play} />
          <KpiCard label="Followers" value={formatNumber(Number(selectedArtist.followers))} icon={Heart} />
          <KpiCard label="Revenue" value={formatRevenueUsd(Number(selectedArtist.revenue))} icon={DollarSign} />
          <KpiCard
            label="Org rank (streams)"
            value={
              data.top_performing_artist?.artist_profile_id === selectedArtist.artist_profile_id
                ? '#1'
                : '—'
            }
            icon={Activity}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">Organization-wide performance overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Artists" value={data.total_artists} icon={Users} />
        <KpiCard label="Monthly Streams" value={formatNumber(Number(data.total_streams))} icon={Play} />
        <KpiCard label="Total Followers" value={formatNumber(Number(data.total_followers))} icon={Heart} />
        <KpiCard label="Total Revenue" value={formatRevenueUsd(Number(data.total_revenue))} icon={DollarSign} />
        <KpiCard label="Albums" value={data.total_albums} icon={Disc3} />
        <KpiCard label="Songs" value={data.total_songs} icon={Music} />
        <KpiCard label="Videos" value={data.total_videos} icon={Video} />
        <KpiCard label="Active Campaigns" value={0} icon={Activity} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground">Top Performing Artist</h3>
          {data.top_performing_artist ? (
            <div className="mt-3">
              <p className="text-lg font-semibold text-foreground">{data.top_performing_artist.stage_name}</p>
              <p className="text-sm text-muted-foreground">
                {formatNumber(Number(data.top_performing_artist.streams))} streams
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground/80">No artists linked yet</p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground">Recent Activity</h3>
          <ul className="mt-3 space-y-2">
            {(data.recent_activity ?? []).length === 0 ? (
              <li className="text-sm text-muted-foreground/80">No recent activity</li>
            ) : (
              data.recent_activity.map((item) => (
                <li key={item.id} className="text-sm text-secondary-foreground">
                  <span className="text-foreground">{item.action.replace(/_/g, ' ')}</span>
                  <span className="ml-2 text-xs text-muted-foreground/80">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
