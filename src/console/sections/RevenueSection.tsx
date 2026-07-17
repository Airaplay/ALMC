import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DollarSign } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { getOrganizationRevenue, OrgRevenueData } from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';

const PERIOD_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
] as const;

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export function RevenueSection() {
  const { organization, hasPermission } = useOrganization();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<OrgRevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organization?.id) return;
    setLoading(true);
    setError(null);
    getOrganizationRevenue(organization.id, days)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load revenue'))
      .finally(() => setLoading(false));
  }, [organization?.id, days]);

  const artistChart = useMemo(
    () =>
      (data?.by_artist ?? []).slice(0, 8).map((a) => ({
        name: a.stage_name.length > 12 ? `${a.stage_name.slice(0, 12)}…` : a.stage_name,
        total: Number(a.total_earnings) || 0,
        ads: Number(a.period_ads) || 0,
      })),
    [data]
  );

  if (!hasPermission('analytics.view') && !hasPermission('org.manage')) {
    return <p className="text-muted-foreground">You don&apos;t have permission to view revenue.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Revenue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only rollup across linked artists. Withdrawals stay on each artist wallet.
          </p>
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
      </div>

      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <LoadingLogo />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      ) : !data ? null : (
        <>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Lifetime (lifetime earnings)</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{formatUsd(data.available)}</p>
              </div>
              <button
                type="button"
                disabled
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground opacity-60"
                title="Org withdrawals come in a later phase"
              >
                Withdraw
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Total', value: data.total },
              { label: 'Treats (pending)', value: data.treats },
              { label: 'Ads (period)', value: data.ads },
              { label: 'Pending', value: data.pending },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{kpi.label}</span>
                  <div className="rounded-lg bg-muted p-2">
                    <DollarSign className="h-4 w-4 text-[#3ba208]" />
                  </div>
                </div>
                <p className="text-xl font-semibold tabular-nums text-foreground">{formatUsd(kpi.value)}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Revenue by Artist</h3>
              <div className="mt-4 h-64">
                {artistChart.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No earnings yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={artistChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: '#141416', border: '1px solid #2a2a2e', borderRadius: 12 }}
                        formatter={(value: number) => formatUsd(value)}
                      />
                      <Bar dataKey="total" fill="#3ba208" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Monthly trend (ads)</h3>
              <div className="mt-4 h-64">
                {(data.monthly_trend ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No monthly payouts yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.monthly_trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: '#141416', border: '1px solid #2a2a2e', borderRadius: 12 }}
                        formatter={(value: number) => formatUsd(value)}
                      />
                      <Line type="monotone" dataKey="amount" stroke="#3ba208" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold text-foreground">By Artist</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Artist</th>
                    <th className="px-5 py-3 font-semibold">Total</th>
                    <th className="px-5 py-3 font-semibold">Ads (period)</th>
                    <th className="px-5 py-3 font-semibold">% of org</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.by_artist ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                        No revenue rows yet
                      </td>
                    </tr>
                  ) : (
                    data.by_artist.map((row) => (
                      <tr key={row.artist_profile_id} className="border-t border-border">
                        <td className="px-5 py-3 font-medium text-foreground">{row.stage_name}</td>
                        <td className="px-5 py-3 tabular-nums text-foreground">{formatUsd(row.total_earnings)}</td>
                        <td className="px-5 py-3 tabular-nums text-muted-foreground">{formatUsd(row.period_ads)}</td>
                        <td className="px-5 py-3 tabular-nums text-muted-foreground">{row.pct_of_org}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
