import React, { useCallback, useEffect, useState } from 'react';
import { Award, TrendingUp, DollarSign, Loader2, RefreshCw } from 'lucide-react';
import {
  getUserContributionScore,
  subscribeToContributionScore,
  getListenerScoreConversionQuote,
  convertListenerScoreToLiveBalance,
  type ContributionScore,
  type ListenerConversionQuote,
} from '../lib/contributionService';
import { useAuth } from '../contexts/AuthContext';

interface ContributionScoreWidgetProps {
  userId?: string;
  compact?: boolean;
  /** Called after a successful convert so parent can refresh Live Balance */
  onConverted?: (payoutUsd: number) => void;
}

export const ContributionScoreWidget: React.FC<ContributionScoreWidgetProps> = ({
  userId,
  compact = false,
  onConverted,
}) => {
  const { user } = useAuth();
  const targetUserId = userId || user?.id;
  const isOwnProfile = !userId || userId === user?.id;
  const [score, setScore] = useState<ContributionScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<ListenerConversionQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertMessage, setConvertMessage] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);

  const loadQuote = useCallback(async () => {
    if (!isOwnProfile) return;
    setQuoteLoading(true);
    setConvertError(null);
    try {
      const data = await getListenerScoreConversionQuote();
      setQuote(data);
    } catch {
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [isOwnProfile]);

  useEffect(() => {
    if (!targetUserId) return;

    const loadScore = async () => {
      try {
        const data = await getUserContributionScore(targetUserId);
        setScore(data);
      } catch (error) {
        console.error('Error loading contribution score:', error);
      } finally {
        setLoading(false);
      }
    };

    loadScore();

    const unsubscribe = subscribeToContributionScore(targetUserId, (updatedScore) => {
      setScore(updatedScore);
    });

    return () => {
      unsubscribe();
    };
  }, [targetUserId]);

  useEffect(() => {
    if (!loading && isOwnProfile && (score?.current_period_points ?? 0) > 0) {
      void loadQuote();
    }
  }, [loading, isOwnProfile, score?.current_period_points, loadQuote]);

  const handleConvert = async () => {
    if (!isOwnProfile || converting) return;
    setConverting(true);
    setConvertError(null);
    setConvertMessage(null);
    try {
      const result = await convertListenerScoreToLiveBalance();
      if (!result.success) {
        setConvertError(result.error || 'Conversion failed');
        await loadQuote();
        return;
      }
      if (result.status === 'duplicate') {
        setConvertMessage('Conversion already processed.');
        return;
      }
      const payout = result.payout_usd ?? 0;
      setConvertMessage(
        `Added $${payout.toFixed(2)} to your Live Balance.`
      );
      if (targetUserId) {
        const fresh = await getUserContributionScore(targetUserId);
        setScore(fresh);
      }
      onConverted?.(payout);
      await loadQuote();
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-white/10 rounded w-1/2 mb-4"></div>
        <div className="h-10 bg-white/10 rounded w-3/4"></div>
      </div>
    );
  }

  const displayScore: ContributionScore = score || {
    user_id: targetUserId || '',
    total_points: 0,
    current_period_points: 0,
    playlist_creation_points: 0,
    discovery_points: 0,
    curation_points: 0,
    engagement_points: 0,
    last_reward_date: null,
    updated_at: new Date().toISOString()
  };

  const canShowConvert =
    isOwnProfile &&
    (displayScore.current_period_points ?? 0) >= (quote?.minimum_points_required ?? 10);

  if (compact) {
    return (
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-white/70" />
            <span className="text-sm font-medium text-white/90">Listener Score</span>
          </div>
          <span className="text-2xl font-bold text-white">
            {displayScore.total_points?.toLocaleString() || 0}
          </span>
        </div>
        <div className="mt-2 text-xs text-white/70">
          This period: {displayScore.current_period_points?.toLocaleString() || 0} pts
        </div>
        {isOwnProfile && quote?.success && quote.estimated_payout_usd != null && quote.estimated_payout_usd > 0 && (
          <p className="mt-2 text-[11px] text-[#5ee4b0]">
            ≈ ${quote.estimated_payout_usd.toFixed(2)} Live Balance if you convert now
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-white/10 rounded-xl">
            <Award className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-['Inter',sans-serif] text-base font-semibold text-white">Listeners Score</h3>
            <p className="text-xs text-white/70">Earn from community value</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-white">
            {displayScore.total_points?.toLocaleString() || 0}
          </div>
          <div className="text-xs text-white/60 mt-0.5">Total Points</div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between px-4 py-3 bg-white/10 rounded-xl border border-white/10">
          <div className="flex items-center gap-2.5">
            <TrendingUp className="w-4 h-4 text-white/70" />
            <span className="text-sm font-medium text-white/90">This Period</span>
          </div>
          <span className="text-sm font-semibold text-white">
            {displayScore.current_period_points?.toLocaleString() || 0} pts
          </span>
        </div>

        <div className="px-4 py-3 bg-white/10 border border-white/10 rounded-xl">
          <p className="font-['Inter',sans-serif] text-xs text-white/90 leading-relaxed">
            <strong>Rewards pool:</strong> Convert points to Live Balance (USD) when the community pool is funded from platform ad revenue. Your share depends on your points vs everyone else&apos;s outstanding score.
          </p>
        </div>

        {isOwnProfile && (displayScore.current_period_points ?? 0) > 0 && (
          <div className="px-4 py-3 bg-[#00ad74]/10 border border-[#00ad74]/25 rounded-xl space-y-3">
            {quoteLoading ? (
              <div className="flex items-center gap-2 text-xs text-white/60">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading conversion estimate…
              </div>
            ) : quote?.success && quote.estimated_payout_usd != null ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <DollarSign className="w-4 h-4 text-[#5ee4b0] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white tabular-nums">
                      ≈ ${quote.estimated_payout_usd.toFixed(2)} USD
                    </p>
                    <p className="text-[10px] text-white/50 truncate">
                      Pool ${(quote.pool_remaining_usd ?? 0).toFixed(2)} · estimate only
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadQuote()}
                  disabled={quoteLoading || converting}
                  className="p-2 rounded-lg text-white/50 hover:text-white/80 hover:bg-white/5"
                  aria-label="Refresh quote"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : quote?.error ? (
              <p className="text-xs text-amber-300/90">{quote.error}</p>
            ) : null}

            {canShowConvert && (
              <button
                type="button"
                onClick={() => void handleConvert()}
                disabled={converting || quoteLoading || !(quote?.success && (quote.estimated_payout_usd ?? 0) > 0)}
                className="w-full min-h-[44px] rounded-xl bg-[#00ad74] hover:bg-[#00c987] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {converting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Converting…
                  </>
                ) : (
                  'Convert to Live Balance'
                )}
              </button>
            )}

            {convertMessage && (
              <p className="text-xs text-[#5ee4b0]">{convertMessage}</p>
            )}
            {convertError && (
              <p className="text-xs text-red-400">{convertError}</p>
            )}
          </div>
        )}

        {displayScore.total_points === 0 && (
          <div className="px-4 py-3 bg-white/10 border border-white/10 rounded-xl">
            <p className="font-['Inter',sans-serif] text-xs text-white/90 leading-relaxed">
              <strong>Get Started:</strong> Create playlists, discover music, and engage to earn points!
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
