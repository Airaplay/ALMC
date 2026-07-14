import { useState, useEffect } from 'react';
import {
  Music, TrendingUp, TrendingDown, Play, Heart, ListPlus,
  MessageCircle, MapPin, RefreshCw, BarChart2, Upload,
} from 'lucide-react';
import { getCreatorAnalyticsOptimized, CreatorAnalytics } from '../../lib/supabase';
import { Skeleton } from '../../components/ui/skeleton';

const formatNumber = (num: number): string => {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(1)}K`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
};

const GrowthPill = ({ value }: { value: number }) => {
  if (value === 0) return null;
  const up = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${
        up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
      }`}
    >
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(value)}%
    </span>
  );
};

const typeLabel = (type: string) => {
  switch (type) {
    case 'short_clip': return 'Clip';
    case 'video': return 'Video';
    case 'album': return 'Album';
    default: return 'Track';
  }
};

const typeAccent = (type: string) => {
  switch (type) {
    case 'video': return 'text-pink-400 bg-pink-500/10';
    case 'short_clip': return 'text-emerald-400 bg-emerald-500/10';
    case 'album': return 'text-purple-400 bg-purple-500/10';
    default: return 'text-sky-400 bg-sky-500/10';
  }
};

export const AnalyticsTab = () => {
  const [analytics, setAnalytics] = useState<CreatorAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getCreatorAnalyticsOptimized();
      setAnalytics(data);
    } catch (err) {
      console.error('Error loading analytics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setIsLoading(false);
    }
  };

  const engagementRate =
    analytics && analytics.totalPlays > 0
      ? ((analytics.totalLikes + analytics.totalComments) / analytics.totalPlays) * 100
      : 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton variant="text" height="20px" width="80px" className="bg-white/10 mb-3" />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Skeleton variant="rectangular" height="96px" className="rounded-2xl bg-white/10" />
            <Skeleton variant="rectangular" height="96px" className="rounded-2xl bg-white/10" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton variant="rectangular" height="72px" className="rounded-2xl bg-white/10" />
            <Skeleton variant="rectangular" height="72px" className="rounded-2xl bg-white/10" />
          </div>
        </div>
        <div>
          <Skeleton variant="text" height="20px" width="120px" className="bg-white/10 mb-3" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rectangular" height="56px" className="rounded-xl bg-white/10" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-6 text-center">
        <BarChart2 className="w-10 h-10 text-white/20 mx-auto mb-3" />
        <p className="text-white font-semibold mb-1">Couldn't load analytics</p>
        <p className="text-white/50 text-sm mb-4">{error}</p>
        <button
          onClick={loadAnalytics}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-black rounded-full text-sm font-semibold active:scale-[0.97] transition-transform"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </button>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="rounded-2xl bg-white/[0.04] p-8 text-center">
        <BarChart2 className="w-10 h-10 text-white/20 mx-auto mb-3" />
        <p className="text-white/50 text-sm">No analytics yet — publish content to start tracking.</p>
      </div>
    );
  }

  const hasLocations =
    analytics.topLocations.length > 0 &&
    analytics.topLocations[0].country !== 'No location data available';

  return (
    <div className="space-y-7 pb-1">

      {/* ── Overview ── */}
      <section>
        <div className="flex items-baseline justify-between mb-3 px-0.5">
          <h3 className="text-[15px] font-semibold text-white">Overview</h3>
          <span className="text-[11px] text-white/35">All time</span>
        </div>

        {/* Hero: Total plays + Total uploads */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.08] to-white/[0.03] border border-white/[0.08] p-4">
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-[#00ad74]/10 blur-2xl pointer-events-none" />
            <div className="relative min-w-0">
              <p className="text-[32px] font-black text-white tabular-nums leading-none tracking-tight">
                {formatNumber(analytics.totalPlays)}
              </p>
              <div className="flex items-center gap-1.5 mt-2">
                <Play className="w-3.5 h-3.5 text-[#00ad74] shrink-0" fill="currentColor" />
                <p className="text-[12px] text-white/50 font-medium truncate">Total plays</p>
              </div>
              <div className="flex items-center gap-1.5 mt-2.5">
                <GrowthPill value={analytics.recentGrowth.playsGrowth} />
                {analytics.recentGrowth.playsGrowth !== 0 && (
                  <span className="text-[10px] text-white/30">vs last week</span>
                )}
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.08] to-white/[0.03] border border-white/[0.08] p-4">
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-sky-500/10 blur-2xl pointer-events-none" />
            <div className="relative min-w-0">
              <p className="text-[32px] font-black text-white tabular-nums leading-none tracking-tight">
                {formatNumber(analytics.totalUploads)}
              </p>
              <div className="flex items-center gap-1.5 mt-2">
                <Upload className="w-3.5 h-3.5 text-sky-400/80 shrink-0" />
                <p className="text-[12px] text-white/50 font-medium truncate">Total uploads</p>
              </div>
            </div>
          </div>
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
            <Heart className="w-4 h-4 text-rose-400/70 mb-3" />
            <p className="text-2xl font-bold text-white tabular-nums leading-none">
              {formatNumber(analytics.totalLikes)}
            </p>
            <p className="text-[11px] text-white/40 mt-1.5 font-medium">Total likes</p>
          </div>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
            <ListPlus className="w-4 h-4 text-[#00ad74]/70 mb-3" />
            <p className="text-2xl font-bold text-white tabular-nums leading-none">
              {formatNumber(analytics.playlistAdds)}
            </p>
            <p className="text-[11px] text-white/40 mt-1.5 font-medium">Playlist adds</p>
          </div>
        </div>
      </section>

      {/* ── Top content ── */}
      {analytics.topContent.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3 px-0.5">
            <h3 className="text-[15px] font-semibold text-white">Top content</h3>
            <span className="text-[11px] text-white/35">By plays</span>
          </div>
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {analytics.topContent.map((content, index) => (
              <div
                key={content.id}
                className="flex items-center gap-3 px-3 py-2.5 active:bg-white/[0.04] transition-colors"
              >
                <span className="w-5 text-center text-[13px] font-bold text-white/25 tabular-nums shrink-0">
                  {index + 1}
                </span>
                {content.coverUrl ? (
                  <img
                    src={content.coverUrl}
                    alt={content.title}
                    className="w-11 h-11 rounded-lg object-cover shrink-0 shadow-sm"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                    <Music className="w-5 h-5 text-white/30" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white truncate leading-snug">{content.title}</p>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${typeAccent(content.type)}`}>
                    {typeLabel(content.type)}
                  </span>
                </div>
                <div className="text-right shrink-0 pl-1">
                  <p className="text-[13px] font-semibold text-white tabular-nums">
                    {formatNumber(content.playCount)}
                  </p>
                  <p className="text-[10px] text-white/35">plays</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Audience ── */}
      <section>
        <div className="flex items-center gap-2 mb-3 px-0.5">
          <MapPin className="w-3.5 h-3.5 text-white/35" />
          <h3 className="text-[15px] font-semibold text-white">Audience</h3>
        </div>

        {hasLocations ? (
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-3.5">
            {analytics.topLocations.map((location) => (
              <div key={location.country}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] text-white/80 font-medium">{location.country}</span>
                  <span className="text-[12px] text-white/40 tabular-nums">
                    {formatNumber(location.count)} · {location.percentage}%
                  </span>
                </div>
                <div className="h-1 bg-white/[0.08] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#00ad74] rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${location.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] px-4 py-5 text-center">
            <MapPin className="w-8 h-8 text-white/15 mx-auto mb-2" />
            <p className="text-[13px] text-white/45 leading-relaxed">
              Location data will appear as listeners discover your music.
            </p>
          </div>
        )}
      </section>

      {/* ── Engagement strip ── */}
      <section>
        <h3 className="text-[15px] font-semibold text-white mb-3 px-0.5">Engagement</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
              <MessageCircle className="w-4 h-4 text-white/40" />
            </div>
            <div>
              <p className="text-xl font-bold text-white tabular-nums leading-none">
                {formatNumber(analytics.totalComments)}
              </p>
              <p className="text-[11px] text-white/40 mt-1">Comments</p>
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#00ad74]/10 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-[#00ad74]/80" />
            </div>
            <div>
              <p className="text-xl font-bold text-white tabular-nums leading-none">
                {engagementRate.toFixed(1)}%
              </p>
              <p className="text-[11px] text-white/40 mt-1">Engagement rate</p>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};
