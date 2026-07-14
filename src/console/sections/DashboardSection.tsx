import { useEffect, useState } from 'react';
import { useOrganization } from '../contexts/OrganizationContext';
import { getOrganizationDashboard, OrgDashboardData } from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import { Users, Play, Heart, DollarSign, Disc3, Music, Video, Activity } from 'lucide-react';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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
  const { organization } = useOrganization();
  const [data, setData] = useState<OrgDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organization?.id) return;
    setLoading(true);
    getOrganizationDashboard(organization.id)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [organization?.id]);

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
        <KpiCard label="Total Revenue" value={formatNumber(Number(data.total_revenue))} icon={DollarSign} />
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
