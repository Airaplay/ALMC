import { useEffect, useState, useCallback } from "react";
import {
  BarChart3, TrendingUp, TrendingDown, Users, Heart, ListMusic,
  MessageSquare, Play, Loader2, AlertCircle, RefreshCw, MapPin,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

interface TopContent {
  id: string;
  title: string;
  type: string;
  playCount: number;
  coverUrl: string | null;
  growthRate: number;
}

interface LocationStat {
  country: string;
  percentage: number;
  listenerCount: number;
}

interface CreatorAnalytics {
  totalPlays: number;
  uniqueListeners: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  playlistAdds: number;
  topContent: TopContent[];
  topLocations: LocationStat[];
  recentGrowth: {
    playsGrowth: number;
    listenersGrowth: number;
    period: string;
  };
}

const fmtNum = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const GrowthBadge = ({ value }: { value: number }) => {
  if (value === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const isUp = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isUp ? "text-green-500" : "text-red-500"}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
};

export const AnalyticsTab = () => {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<CreatorAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "get_creator_analytics_optimized" as any,
        { p_user_id: user.id }
      );

      if (rpcError) throw rpcError;

      const d = data as any;
      setAnalytics({
        totalPlays: d?.totalPlays ?? d?.total_plays ?? 0,
        uniqueListeners: d?.uniqueListeners ?? d?.unique_listeners ?? 0,
        totalLikes: d?.totalLikes ?? d?.total_likes ?? 0,
        totalComments: d?.totalComments ?? d?.total_comments ?? 0,
        totalShares: d?.totalShares ?? d?.total_shares ?? 0,
        playlistAdds: d?.playlistAdds ?? d?.playlist_adds ?? 0,
        topContent: (d?.topContent ?? d?.top_content ?? []).map((c: any) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          playCount: c.playCount ?? c.play_count ?? 0,
          coverUrl: c.coverUrl ?? c.cover_url ?? null,
          growthRate: c.growthRate ?? c.growth_rate ?? 0,
        })),
        topLocations: (d?.topLocations ?? d?.top_locations ?? []).map((l: any) => ({
          country: l.country,
          percentage: l.percentage ?? 0,
          listenerCount: l.listenerCount ?? l.listener_count ?? 0,
        })),
        recentGrowth: {
          playsGrowth: d?.recentGrowth?.playsGrowth ?? d?.recent_growth?.plays_growth ?? 0,
          listenersGrowth: d?.recentGrowth?.listenersGrowth ?? d?.recent_growth?.listeners_growth ?? 0,
          period: d?.recentGrowth?.period ?? d?.recent_growth?.period ?? "week",
        },
      });
    } catch (e: any) {
      console.error("Analytics load error:", e);
      setError(e.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  /* ─── Loading ─── */
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }

  /* ─── Error ─── */
  if (error) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={loadAnalytics} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  /* ─── Empty ─── */
  if (!analytics) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6 text-center">
          <BarChart3 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No analytics data available yet.</p>
        </CardContent>
      </Card>
    );
  }

  const engagementRate =
    analytics.totalPlays > 0
      ? ((analytics.totalLikes + analytics.totalComments) / analytics.totalPlays) * 100
      : 0;

  const overviewCards = [
    { label: "Total Plays", value: analytics.totalPlays, icon: Play, growth: analytics.recentGrowth.playsGrowth },
    { label: "Unique Listeners", value: analytics.uniqueListeners, icon: Users, growth: analytics.recentGrowth.listenersGrowth },
    { label: "Total Likes", value: analytics.totalLikes, icon: Heart },
    { label: "Playlist Adds", value: analytics.playlistAdds, icon: ListMusic },
  ];

  return (
    <div className="space-y-5">
      {/* ─── Performance Overview ─── */}
      <div className="grid grid-cols-2 gap-3">
        {overviewCards.map((card) => (
          <Card key={card.label} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <card.icon className="w-4 h-4 text-foreground/60" />
                {card.growth !== undefined && <GrowthBadge value={card.growth} />}
              </div>
              <p className="text-2xl font-bold text-foreground">{fmtNum(card.value)}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Top Performing Content ─── */}
      {analytics.topContent.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-foreground/60" /> Top Performing Content
            </h3>
            <div className="space-y-2">
              {analytics.topContent.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition-colors">
                  <span className="text-xs font-bold text-muted-foreground w-5 text-center">#{idx + 1}</span>
                  <div className="w-10 h-10 rounded bg-muted overflow-hidden flex-shrink-0">
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Play className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground capitalize">{item.type.replace("_", " ")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">{fmtNum(item.playCount)}</p>
                    <p className="text-xs text-muted-foreground">plays</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Audience Insights ─── */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <MapPin className="w-4 h-4 text-foreground/60" /> Audience Insights
          </h3>

          {/* Locations */}
          {analytics.topLocations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Top Locations</p>
              {analytics.topLocations.map((loc) => (
                <div key={loc.country} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{loc.country}</span>
                    <span className="text-muted-foreground">{loc.percentage.toFixed(1)}%</span>
                  </div>
                  <Progress value={loc.percentage} className="h-1.5" />
                </div>
              ))}
            </div>
          )}

          {/* Engagement */}
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Engagement</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Comments</span>
                </div>
                <p className="text-lg font-bold text-foreground">{fmtNum(analytics.totalComments)}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Engagement Rate</span>
                </div>
                <p className="text-lg font-bold text-foreground">{engagementRate.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
