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
import { consoleTheme } from '../consoleTheme';

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
        total: Number(a.gross_total) || 0,
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
            Read-only rollup across linked artists. Revenue is broken into org share and artist share.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className={consoleTheme.select}
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
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{error}</div>
      ) : !data ? null : (
        <>
          <div className={`${consoleTheme.card} p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={consoleTheme.label}>Gross linked artist earnings</p>
                <p className={`mt-2 ${consoleTheme.display}`}>{formatUsd(data.gross_total)}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Default split: {data.org_split_pct}% org / {data.artist_split_pct}% artist
                </p>
              </div>
              <button
                type="button"
                disabled
                className={`${consoleTheme.btnSecondary} opacity-50`}
                title="Org withdrawals come in a later phase"
              >
                Withdraw
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: 'Org share', value: data.org_share_total },
              { label: 'Artist share', value: data.artist_share_total },
              { label: 'Treats (pending)', value: data.treats },
            ].map((kpi) => (
              <div key={kpi.label} className={`${consoleTheme.card} p-5`}>
                <div className="mb-4 flex items-center justify-between">
                  <span className={consoleTheme.label}>{kpi.label}</span>
                  <div className={consoleTheme.iconWell}>
                    <DollarSign className="h-4 w-4" strokeWidth={1.75} />
                  </div>
                </div>
                <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
                  {formatUsd(kpi.value)}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${consoleTheme.card} p-5`}>
              <h3 className={consoleTheme.label}>Gross Revenue by Artist</h3>
              <div className="mt-4 h-64">
                {artistChart.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No earnings yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={artistChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 20,
                          fontSize: 12,
                        }}
                        formatter={(value: number) => formatUsd(value)}
                      />
                      <Bar dataKey="total" fill="#33AA2D" radius={[10, 10, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className={`${consoleTheme.card} p-5`}>
              <h3 className={consoleTheme.label}>Monthly trend</h3>
              <div className="mt-4 h-64">
                {(data.monthly_trend ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No monthly payouts yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.monthly_trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="month" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 20,
                          fontSize: 12,
                        }}
                        formatter={(value: number) => formatUsd(value)}
                      />
                      <Line type="monotone" dataKey="amount" stroke="#000000" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Trend reflects linked artist payout activity before any ALMC share is applied.
              </p>
            </div>
          </div>

          <div className={`overflow-hidden ${consoleTheme.card}`}>
            <div className="border-b border-border/70 px-5 py-3.5">
              <h3 className={consoleTheme.label}>By Artist</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[480px] w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Artist</th>
                    <th className="px-5 py-3 font-semibold">Gross</th>
                    <th className="px-5 py-3 font-semibold">Org share</th>
                    <th className="px-5 py-3 font-semibold">Artist share</th>
                    <th className="px-5 py-3 font-semibold">% of gross</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.by_artist ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                        No revenue rows yet
                      </td>
                    </tr>
                  ) : (
                    data.by_artist.map((row) => (
                      <tr key={row.artist_profile_id} className="border-t border-border">
                        <td className="px-5 py-3 font-medium text-foreground">{row.stage_name}</td>
                        <td className="px-5 py-3 tabular-nums text-foreground">{formatUsd(row.gross_total)}</td>
                        <td className="px-5 py-3 tabular-nums text-foreground">{formatUsd(row.org_share_total)}</td>
                        <td className="px-5 py-3 tabular-nums text-foreground">{formatUsd(row.artist_share_total)}</td>
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
