import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, DollarSign, TrendingUp, Users, Zap, AlertCircle, CheckCircle, Info, Settings, Eye, PlayCircle, RefreshCw, RefreshCcw, History, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ConversionSettings {
  id: string;
  conversion_rate: number;
  conversion_rate_description: string;
  is_active: boolean;
  max_payout_per_user_usd: number | null;
  minimum_points_for_payout: number;
  /** % of platform AdMob share allocated to listener pool (default 15) — not external topups */
  platform_to_pool_percentage?: number;
  /** When true, pg_cron may run automated conversion (daily at UTC time below) */
  auto_execute_monthly_conversion?: boolean;
  auto_conversion_run_hour_utc?: number;
  auto_conversion_run_minute_utc?: number;
  /** UTC instant — automation suppressed until this time */
  auto_conversion_not_before_utc?: string | null;
  self_service_conversion_enabled?: boolean;
  auto_fund_pool_from_admob?: boolean;
  updated_at: string;
}

interface PoolSuggestion {
  error?: string;
  period_start?: string;
  period_end?: string;
  usable_net_total_usd?: number;
  platform_revenue_usd?: number;
  pool_percentage?: number;
  suggested_pool_usd?: number;
  admob_days_count?: number;
  caps_missing?: boolean;
  pending_external_revenue_topup_usd?: number;
  pending_external_revenue_topup_count?: number;
  combined_suggested_pool_usd?: number;
}

interface ConversionHistory {
  id: string;
  conversion_date: string;
  reward_pool_usd: number;
  total_points_converted: number;
  total_users_paid: number;
  conversion_rate_used: number;
  actual_rate_applied: number;
  scaling_applied: boolean;
  total_distributed_usd: number;
  status: string;
  created_at: string;
}

interface ConversionPreview {
  total_eligible_points: number;
  estimated_payout_usd: number;
  eligible_users_count: number;
  conversion_rate: number;
  minimum_points_required: number;
}

interface AdminUserRef {
  display_name: string | null;
  email: string | null;
  username: string | null;
}

interface PoolFundingHistoryRow {
  id: string;
  credited_at: string;
  revenue_date: string | null;
  source_label: string;
  gross_usd: number | null;
  platform_share_usd: number | null;
  pool_percentage: number | null;
  funded_usd: number;
  pool_period: string | null;
}

interface UserConversionRow {
  id: string;
  created_at: string;
  user_id: string;
  user_label: string;
  conversion_type: string;
  points: number;
  payout_usd: number;
  weighted_points: number | null;
  effective_rate: number | null;
  pool_period: string | null;
  status: string | null;
}

function utcPartsFromIso(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const s = d.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** Interprets date + optional time as UTC wall clock for Postgres timestamptz. */
function buildNotBeforeUtcIso(dateStr: string, timeStr: string): string | null {
  const d = dateStr.trim();
  if (!d) return null;
  const t = timeStr.trim() || '00:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  return `${d}T${t}:00.000Z`;
}

function formatUserLabel(user: AdminUserRef | null | undefined, userId: string): string {
  if (!user) return userId.slice(0, 8);
  return user.display_name || user.username || user.email || userId.slice(0, 8);
}

function formatFundingSource(source: string | null | undefined): string {
  switch (source) {
    case 'admob_locked_daily':
      return 'AdMob (locked day)';
    case 'external_revenue_topup':
      return 'External revenue topup';
    default:
      return source || 'Unknown';
  }
}

function formatConversionType(source: string): string {
  switch (source) {
    case 'self_service':
      return 'Self-service';
    case 'monthly_conversion':
      return 'Batch monthly';
    default:
      return source;
  }
}

/** Pool balances are often sub-cent; avoid rounding tiny funded amounts to $0.00. */
function formatPoolUsd(amount: number | undefined): string {
  const value = amount ?? 0;
  if (value === 0) {
    return '0.00';
  }
  if (Math.abs(value) < 0.01) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const MonthlyConversionSection: React.FC = () => {
  const [settings, setSettings] = useState<ConversionSettings | null>(null);
  const [preview, setPreview] = useState<ConversionPreview | null>(null);
  const [history, setHistory] = useState<ConversionHistory[]>([]);
  const [poolFundingHistory, setPoolFundingHistory] = useState<PoolFundingHistoryRow[]>([]);
  const [userConversionHistory, setUserConversionHistory] = useState<UserConversionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Conversion form state
  const [rewardPoolAmount, setRewardPoolAmount] = useState<string>('');
  const [conversionDate, setConversionDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Settings form state
  const [editingSettings, setEditingSettings] = useState(false);
  const [newConversionRate, setNewConversionRate] = useState<string>('');
  const [rateDescription, setRateDescription] = useState<string>('');
  const [newPlatformPoolPct, setNewPlatformPoolPct] = useState<string>('15');
  const [autoExecuteMonthly, setAutoExecuteMonthly] = useState(false);
  const [autoRunHourUtc, setAutoRunHourUtc] = useState(7);
  const [autoRunMinuteUtc, setAutoRunMinuteUtc] = useState(0);
  const [autoNotBeforeDateUtc, setAutoNotBeforeDateUtc] = useState('');
  const [autoNotBeforeTimeUtc, setAutoNotBeforeTimeUtc] = useState('');
  const [autoFundPoolFromAdmob, setAutoFundPoolFromAdmob] = useState(true);

  const [poolSuggestion, setPoolSuggestion] = useState<PoolSuggestion | null>(null);
  const [poolSuggestionLoading, setPoolSuggestionLoading] = useState(false);
  const [fundingPool, setFundingPool] = useState(false);
  const [fundingTopups, setFundingTopups] = useState(false);
  const [poolStatus, setPoolStatus] = useState<{
    has_active_pool?: boolean;
    period_start?: string;
    period_end?: string;
    funded_usd?: number;
    distributed_usd?: number;
    remaining_usd?: number;
    platform_weighted_outstanding?: number;
    effective_rate_if_all_weighted_converted?: number;
  } | null>(null);

  const selfServiceEnabled = settings?.self_service_conversion_enabled !== false;

  const poolMonthValue = conversionDate ? conversionDate.slice(0, 7) : '';
  const isViewingActivePoolMonth =
    !!poolStatus?.period_start &&
    !!conversionDate &&
    conversionDate >= poolStatus.period_start &&
    conversionDate <= (poolStatus.period_end ?? poolStatus.period_start);
  const activePoolFundedUsd = isViewingActivePoolMonth ? (poolStatus?.funded_usd ?? 0) : null;
  const suggestedPoolUsd = poolSuggestion?.suggested_pool_usd ?? 0;
  const pendingExternalUsd = poolSuggestion?.pending_external_revenue_topup_usd ?? 0;
  const pendingExternalCount = poolSuggestion?.pending_external_revenue_topup_count ?? 0;
  const combinedSuggestedPoolUsd =
    poolSuggestion?.combined_suggested_pool_usd ?? suggestedPoolUsd + pendingExternalUsd;
  const poolFundingGapUsd =
    activePoolFundedUsd != null ? Math.max(0, suggestedPoolUsd - activePoolFundedUsd) : null;
  const totalPoolFundingGapUsd =
    activePoolFundedUsd != null ? Math.max(0, combinedSuggestedPoolUsd - activePoolFundedUsd) : null;

  const poolFundingBreakdown = useMemo(() => {
    if (!isViewingActivePoolMonth || !poolStatus?.period_start || !poolStatus?.period_end) {
      return null;
    }
    const start = poolStatus.period_start;
    const end = poolStatus.period_end;
    const monthPrefix = start.slice(0, 7);

    let admobFundedUsd = 0;
    let externalFundedUsd = 0;

    for (const row of poolFundingHistory) {
      if (!row.revenue_date) continue;
      if (row.source_label === 'AdMob (locked day)') {
        if (row.revenue_date >= start && row.revenue_date <= end) {
          admobFundedUsd += row.funded_usd;
        }
      } else if (row.source_label === 'External revenue topup') {
        if (row.revenue_date.slice(0, 7) === monthPrefix) {
          externalFundedUsd += row.funded_usd;
        }
      }
    }

    return { admobFundedUsd, externalFundedUsd };
  }, [poolFundingHistory, isViewingActivePoolMonth, poolStatus?.period_start, poolStatus?.period_end]);

  const admobCatchUpGapUsd =
    poolFundingBreakdown && activePoolFundedUsd != null
      ? Math.max(0, suggestedPoolUsd - poolFundingBreakdown.admobFundedUsd)
      : poolFundingGapUsd;

  const handlePoolMonthChange = (monthValue: string) => {
    if (!monthValue) return;
    setConversionDate(`${monthValue}-01`);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 7000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!conversionDate) return;
      setPoolSuggestionLoading(true);
      setPoolSuggestion(null);
      const { data, error: rpcErr } = await supabase.rpc(
        'admin_suggest_contribution_pool_from_platform_revenue',
        { p_period_date: conversionDate }
      );
      if (cancelled) return;
      setPoolSuggestionLoading(false);
      if (rpcErr) {
        console.warn('Pool suggestion RPC:', rpcErr);
        setPoolSuggestion({ error: rpcErr.message });
        return;
      }
      setPoolSuggestion((data as PoolSuggestion) || null);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [conversionDate, settings?.platform_to_pool_percentage]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load conversion settings
      const { data: settingsData, error: settingsError } = await supabase
        .from('contribution_conversion_settings')
        .select('*')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (settingsError && settingsError.code !== 'PGRST116') throw settingsError;
      setSettings(settingsData);

      if (settingsData) {
        setNewConversionRate(settingsData.conversion_rate.toString());
        setRateDescription(settingsData.conversion_rate_description || '');
        const poolPct =
          typeof settingsData.platform_to_pool_percentage === 'number'
            ? settingsData.platform_to_pool_percentage
            : 15;
        setNewPlatformPoolPct(String(poolPct));
        setAutoExecuteMonthly(!!settingsData.auto_execute_monthly_conversion);
        const h =
          typeof settingsData.auto_conversion_run_hour_utc === 'number'
            ? settingsData.auto_conversion_run_hour_utc
            : 7;
        const m =
          typeof settingsData.auto_conversion_run_minute_utc === 'number'
            ? settingsData.auto_conversion_run_minute_utc
            : 0;
        setAutoRunHourUtc(h);
        setAutoRunMinuteUtc(m);
        const nb = utcPartsFromIso(settingsData.auto_conversion_not_before_utc);
        setAutoNotBeforeDateUtc(nb.date);
        setAutoNotBeforeTimeUtc(nb.time);
        setAutoFundPoolFromAdmob(settingsData.auto_fund_pool_from_admob !== false);
      }

      // Load conversion preview
      const { data: previewData, error: previewError } = await supabase
        .rpc('get_conversion_preview');

      if (previewError) throw previewError;
      if (previewData && previewData.length > 0) {
        setPreview(previewData[0]);
      }

      const { data: poolStatusData, error: poolStatusError } = await supabase.rpc(
        'get_listener_rewards_pool_status'
      );
      if (!poolStatusError) {
        setPoolStatus(poolStatusData as typeof poolStatus);
      }

      // Load conversion history
      const { data: historyData, error: historyError } = await supabase
        .from('contribution_conversion_history')
        .select('*')
        .order('conversion_date', { ascending: false })
        .limit(50);

      if (historyError) throw historyError;
      setHistory(historyData || []);

      const { data: fundingData, error: fundingError } = await supabase
        .from('listener_pool_daily_funding')
        .select(
          `
          id,
          revenue_date,
          gross_revenue_usd,
          platform_share_usd,
          pool_percentage,
          funded_usd,
          source,
          created_at,
          pool:listener_rewards_pool!listener_pool_daily_funding_pool_id_fkey(period_start, period_end)
        `
        )
        .order('revenue_date', { ascending: false })
        .limit(50);

      if (fundingError) {
        console.warn('Pool funding history:', fundingError);
        setPoolFundingHistory([]);
      } else {
        const dailyRows: PoolFundingHistoryRow[] = (fundingData || []).map((row) => {
          const pool = row.pool as { period_start?: string; period_end?: string } | null;
          return {
            id: row.id,
            credited_at: row.created_at,
            revenue_date: row.revenue_date,
            source_label: formatFundingSource(row.source),
            gross_usd: row.gross_revenue_usd,
            platform_share_usd: row.platform_share_usd,
            pool_percentage: row.pool_percentage,
            funded_usd: row.funded_usd,
            pool_period:
              pool?.period_start && pool?.period_end
                ? `${pool.period_start} — ${pool.period_end}`
                : null,
          };
        });

        const { data: topupData, error: topupError } = await supabase
          .from('external_revenue_contribution_pool_topups')
          .select('id, amount_usd, status, consumed_at, consumed_for_period_date')
          .eq('status', 'consumed')
          .order('consumed_at', { ascending: false })
          .limit(20);

        const topupRows: PoolFundingHistoryRow[] = topupError
          ? []
          : (topupData || []).map((row) => ({
              id: row.id,
              credited_at: row.consumed_at || row.consumed_for_period_date,
              revenue_date: row.consumed_for_period_date,
              source_label: formatFundingSource('external_revenue_topup'),
              gross_usd: null,
              platform_share_usd: null,
              pool_percentage: null,
              funded_usd: row.amount_usd,
              pool_period: row.consumed_for_period_date
                ? `${row.consumed_for_period_date.slice(0, 7)} (month)`
                : null,
            }));

        setPoolFundingHistory(
          [...dailyRows, ...topupRows].sort(
            (a, b) => new Date(b.credited_at).getTime() - new Date(a.credited_at).getTime()
          )
        );
      }

      const { data: selfServiceData, error: selfServiceError } = await supabase
        .from('listener_score_conversions')
        .select(
          `
          id,
          user_id,
          points_converted,
          weighted_points_converted,
          payout_usd,
          effective_rate_per_weighted_point,
          created_at,
          user:users!listener_score_conversions_user_id_fkey(display_name, email, username),
          pool:listener_rewards_pool!listener_score_conversions_pool_id_fkey(period_start, period_end)
        `
        )
        .order('created_at', { ascending: false })
        .limit(50);

      const { data: batchUserData, error: batchUserError } = await supabase
        .from('contribution_rewards_history')
        .select(
          `
          id,
          user_id,
          period_date,
          contribution_points,
          reward_amount_usd,
          reward_source,
          status,
          created_at,
          user:users!contribution_rewards_history_user_id_fkey(display_name, email, username)
        `
        )
        .in('reward_source', ['monthly_conversion'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (selfServiceError) console.warn('User self-service conversions:', selfServiceError);
      if (batchUserError) console.warn('User batch conversions:', batchUserError);

      const selfServiceRows: UserConversionRow[] = (selfServiceData || []).map((row) => {
        const user = row.user as AdminUserRef | null;
        const pool = row.pool as { period_start?: string; period_end?: string } | null;
        return {
          id: `ssc-${row.id}`,
          created_at: row.created_at,
          user_id: row.user_id,
          user_label: formatUserLabel(user, row.user_id),
          conversion_type: 'self_service',
          points: row.points_converted,
          payout_usd: row.payout_usd,
          weighted_points: row.weighted_points_converted,
          effective_rate: row.effective_rate_per_weighted_point,
          pool_period:
            pool?.period_start && pool?.period_end
              ? `${pool.period_start} — ${pool.period_end}`
              : null,
          status: 'completed',
        };
      });

      const batchRows: UserConversionRow[] = (batchUserData || [])
        .filter((row) => row.reward_source === 'monthly_conversion')
        .map((row) => {
          const user = row.user as AdminUserRef | null;
          return {
            id: `crh-${row.id}`,
            created_at: row.created_at,
            user_id: row.user_id,
            user_label: formatUserLabel(user, row.user_id),
            conversion_type: 'monthly_conversion',
            points: row.contribution_points,
            payout_usd: row.reward_amount_usd,
            weighted_points: null,
            effective_rate: null,
            pool_period: row.period_date,
            status: row.status,
          };
        });

      setUserConversionHistory(
        [...selfServiceRows, ...batchRows].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      );

    } catch (err) {
      console.error('Error loading conversion data:', err);
      setError('Failed to load conversion data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConversionRate = async () => {
    if (!newConversionRate || parseFloat(newConversionRate) <= 0) {
      setError('Conversion rate must be greater than zero');
      return;
    }

    const poolPct = parseFloat(newPlatformPoolPct);
    if (!Number.isFinite(poolPct) || poolPct < 0 || poolPct > 100) {
      setError('Platform → pool % must be between 0 and 100');
      return;
    }

    if (autoExecuteMonthly) {
      if (autoNotBeforeTimeUtc.trim() && !autoNotBeforeDateUtc.trim()) {
        setError('Clear the earliest time or set an earliest start date (both in UTC).');
        return;
      }
    }

    const runH = Math.min(23, Math.max(0, Math.round(Number(autoRunHourUtc))));
    const runM = Math.min(59, Math.max(0, Math.round(Number(autoRunMinuteUtc))));
    if (!Number.isFinite(runH) || !Number.isFinite(runM)) {
      setError('Run time (UTC hour and minute) must be valid numbers.');
      return;
    }

    const notBeforeIso = autoNotBeforeDateUtc.trim()
      ? buildNotBeforeUtcIso(autoNotBeforeDateUtc, autoNotBeforeTimeUtc)
      : null;
    if (autoNotBeforeDateUtc.trim() && !notBeforeIso) {
      setError('Invalid earliest start: use date YYYY-MM-DD and optional time HH:MM (UTC).');
      return;
    }

    try {
      setProcessing(true);
      setError(null);
      setSuccess(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('You must be logged in');
      }

      const { error: updateError } = await supabase.rpc('admin_update_conversion_rate', {
        p_new_rate: parseFloat(newConversionRate),
        p_description: rateDescription || null
      });

      if (updateError) throw updateError;

      const { data: poolRes, error: poolErr } = await supabase.rpc(
        'admin_set_platform_to_pool_percentage',
        { p_percentage: poolPct }
      );
      if (poolErr) throw poolErr;
      if (poolRes && typeof poolRes === 'object' && 'success' in poolRes && poolRes.success === false) {
        throw new Error((poolRes as { error?: string }).error || 'Failed to save platform pool percentage');
      }

      const { error: autoErr } = await supabase
        .from('contribution_conversion_settings')
        .update({
          auto_execute_monthly_conversion: autoExecuteMonthly,
          auto_conversion_run_hour_utc: runH,
          auto_conversion_run_minute_utc: runM,
          auto_conversion_not_before_utc: notBeforeIso,
          auto_fund_pool_from_admob: autoFundPoolFromAdmob,
        })
        .eq('is_active', true);

      if (autoErr) throw autoErr;

      setSuccess('Conversion settings updated successfully');
      setEditingSettings(false);
      await loadData();

    } catch (err) {
      console.error('Error updating conversion rate:', err);
      setError(err instanceof Error ? err.message : 'Failed to update conversion rate');
    } finally {
      setProcessing(false);
    }
  };

  const handleAdmobPoolCatchUp = async () => {
    try {
      setFundingPool(true);
      setError(null);
      const { data, error: rpcErr } = await supabase.rpc('fund_listener_pool_pending_locked_days', {
        p_through_date: conversionDate || new Date().toISOString().split('T')[0],
        p_include_external_topups: false,
      });
      if (rpcErr) throw rpcErr;
      const funded = (data as { funded_or_recorded?: number })?.funded_or_recorded ?? 0;
      setSuccess(
        `AdMob catch-up complete. Processed ${funded} locked day(s) into the listener pool.`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run AdMob pool catch-up');
    } finally {
      setFundingPool(false);
    }
  };

  const handleFundExternalTopups = async () => {
    try {
      setFundingTopups(true);
      setError(null);
      const { data, error: rpcErr } = await supabase.rpc('fund_listener_pool_from_external_topups', {
        p_period_date: conversionDate || new Date().toISOString().split('T')[0],
      });
      if (rpcErr) throw rpcErr;
      const result = data as { ok?: boolean; error?: string; funded_usd?: number; consumed_count?: number };
      if (result?.ok === false) {
        throw new Error(result.error || 'Failed to apply external topups');
      }
      const usd = result?.funded_usd ?? 0;
      setSuccess(
        usd > 0
          ? `Applied $${usd.toFixed(2)} from ${result?.consumed_count ?? 0} external topup(s) to the listener pool.`
          : 'No pending external topups to apply.'
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply external topups');
    } finally {
      setFundingTopups(false);
    }
  };

  const handleProcessConversion = async () => {
    if (!rewardPoolAmount || parseFloat(rewardPoolAmount) <= 0) {
      setError('Reward pool amount must be greater than zero');
      return;
    }

    if (!conversionDate) {
      setError('Please select a conversion date');
      return;
    }

    try {
      setProcessing(true);
      setError(null);
      setSuccess(null);

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error('Auth user error:', userError);
        throw new Error('You must be logged in. Please refresh the page and try again.');
      }

      // Verify user is admin
      const { data: userData, error: userDataError } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      if (userDataError || !userData) {
        console.error('User data error:', userDataError);
        throw new Error('Unable to verify user permissions. Please try again.');
      }

      if (userData.role !== 'admin') {
        throw new Error('Admin access required to perform this action.');
      }

      // Get fresh session to ensure auth context
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        console.error('Session error:', sessionError);
        throw new Error('No active session found. Please log out and log back in.');
      }

      console.log('Processing conversion with:', {
        userId: user.id,
        userRole: userData.role,
        date: conversionDate,
        amount: parseFloat(rewardPoolAmount)
      });

      const { data, error: conversionError } = await supabase
        .rpc('admin_distribute_contribution_rewards', {
          p_period_date: conversionDate,
          p_reward_pool_usd: parseFloat(rewardPoolAmount),
          p_include_external_revenue_topups: true,
        });

      if (conversionError) {
        console.error('Conversion error details:', {
          message: conversionError.message,
          details: conversionError.details,
          hint: conversionError.hint,
          code: conversionError.code
        });
        throw new Error(conversionError.message || 'Failed to process conversion');
      }

      if (data && data.length > 0) {
        const result = data[0];
        setSuccess(
          `Conversion completed! Distributed $${result.total_distributed_usd} USD to ${result.distributed_count} users. ` +
          `${result.scaling_applied ? 'Proportional scaling was applied.' : 'No scaling needed.'}`
        );
        setRewardPoolAmount('');
        await loadData();
      } else {
        setSuccess('Conversion completed but no users were eligible for rewards.');
        await loadData();
      }

    } catch (err) {
      console.error('Error processing conversion:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to process conversion';
      setError(`Conversion failed: ${errorMessage}`);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
        <p className="ml-3 text-gray-600">Loading conversion data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
          <RefreshCcw className="w-4 h-4 text-green-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Monthly Conversion</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {selfServiceEnabled
              ? 'Self-service Listener Score → Live Balance, funded from AdMob + External Revenue'
              : 'Manage monthly contribution reward conversions'}
          </p>
        </div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="p-4 bg-green-50 border-l-4 border-green-600 rounded-r-lg flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-green-900 text-sm">Success</p>
            <p className="text-green-700 text-sm">{success}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border-l-4 border-red-600 rounded-r-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-900 text-sm">Error</p>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Conversion Settings */}
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Settings className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Conversion Settings</h3>
              <p className="text-xs text-gray-500">Configure the points-to-Treats conversion rate</p>
            </div>
          </div>
          {!editingSettings && (
            <button
              onClick={() => setEditingSettings(true)}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium transition-colors"
            >
              Edit Settings
            </button>
          )}
        </div>

        {settings && !editingSettings && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-600 uppercase tracking-wider mb-1">Conversion Rate</p>
              <p className="text-2xl font-bold text-gray-900">{settings.conversion_rate}</p>
              <p className="text-xs text-gray-600 mt-1">USD per point</p>
            </div>
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-xs text-[#309605] uppercase tracking-wider mb-1">Minimum Points</p>
              <p className="text-2xl font-bold text-gray-900">{settings.minimum_points_for_payout}</p>
              <p className="text-xs text-gray-600 mt-1">Required for payout</p>
            </div>
            <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-xs text-orange-700 uppercase tracking-wider mb-1">Platform AdMob → pool</p>
              <p className="text-2xl font-bold text-gray-900">
                {typeof settings.platform_to_pool_percentage === 'number'
                  ? settings.platform_to_pool_percentage
                  : 15}
                %
              </p>
              <p className="text-xs text-gray-600 mt-1">Of platform AdMob share (50/50 caps)</p>
            </div>
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-xs text-emerald-700 uppercase tracking-wider mb-1">Conversion mode</p>
              <p className="text-2xl font-bold text-gray-900">
                {selfServiceEnabled ? 'Self-service' : 'Admin batch'}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {selfServiceEnabled
                  ? 'Users convert points; pool funded from AdMob + External Revenue'
                  : 'Admin runs monthly batch conversion'}
              </p>
            </div>
            <div className="p-4 bg-violet-50 border border-violet-200 rounded-lg">
              <p className="text-xs text-violet-700 uppercase tracking-wider mb-1">Auto scheduled run</p>
              <p className="text-2xl font-bold text-gray-900">
                {settings.auto_execute_monthly_conversion ? 'On' : 'Off'}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {selfServiceEnabled ? (
                  'Batch automation only — ignored while self-service is on'
                ) : settings.auto_execute_monthly_conversion ? (
                  `Daily ~${String(settings.auto_conversion_run_hour_utc ?? 7).padStart(2, '0')}:${String(
                    settings.auto_conversion_run_minute_utc ?? 0
                  ).padStart(2, '0')} UTC · previous calendar month`
                ) : (
                  'Disabled'
                )}
                {!selfServiceEnabled && settings.auto_conversion_not_before_utc ? (
                  <span className="block mt-1 text-violet-800">
                    Not before {utcPartsFromIso(settings.auto_conversion_not_before_utc).date}{' '}
                    {utcPartsFromIso(settings.auto_conversion_not_before_utc).time} UTC
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        )}

        {editingSettings && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Conversion Rate (USD per point)
              </label>
              <input
                type="number"
                step="0.000001"
                value={newConversionRate}
                onChange={(e) => setNewConversionRate(e.target.value)}
                placeholder="e.g., 0.001"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
              />
              <p className="text-xs text-gray-500 mt-1">
                Example: 0.001 means 1 point = 0.001 USD = 1 Treat
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Description (Optional)
              </label>
              <input
                type="text"
                value={rateDescription}
                onChange={(e) => setRateDescription(e.target.value)}
                placeholder="e.g., Points to Treats conversion rate"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Platform AdMob share → listener pool (%)
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={newPlatformPoolPct}
                onChange={(e) => setNewPlatformPoolPct(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
              />
              <p className="text-xs text-gray-500 mt-1">
                Listener pool from AdMob only: this % × platform share of locked AdMob usable net for the month. External
                revenue is separate topups (manual).
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 bg-gray-50 p-3">
              <input
                type="checkbox"
                className="mt-1 rounded border-gray-300 text-green-600 focus:ring-green-600"
                checked={autoFundPoolFromAdmob}
                onChange={(e) => setAutoFundPoolFromAdmob(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">
                  Automatically fund listener pool from locked AdMob days
                </span>
                <span className="block text-xs text-gray-600 mt-0.5">
                  When enabled, each locked AdMob day credits the listener pool immediately, with a daily catch-up at{' '}
                  <strong>04:15 UTC</strong>. External-revenue topups are never automatic — apply those manually below.
                </span>
              </span>
            </label>

            <label className={`flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 bg-gray-50 p-3 ${selfServiceEnabled ? 'opacity-60' : ''}`}>
              <input
                type="checkbox"
                className="mt-1 rounded border-gray-300 text-green-600 focus:ring-green-600"
                checked={autoExecuteMonthly}
                disabled={selfServiceEnabled}
                onChange={(e) => setAutoExecuteMonthly(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">
                  Automatically execute conversion (daily)
                </span>
                <span className="block text-xs text-gray-600 mt-0.5">
                  {selfServiceEnabled ? (
                    <>
                      Disabled while <strong>self-service conversion</strong> is on. Users convert their own points
                      against the listener pool (AdMob auto-funding + applied external topups) instead of an admin batch
                      run.
                    </>
                  ) : (
                    <>
                      Once every 24 hours at the <strong>UTC</strong> time you set below, the system attempts conversion
                      for the <strong>previous</strong> calendar month using the suggested pool (platform AdMob share ×
                      this %). Skips if that month is already completed, if disabled here, or if the suggested pool is
                      zero. Requires pg_cron, Edge Function{' '}
                      <code className="text-[11px] bg-white px-1 rounded">contribution-monthly-convert</code>, and
                      service-role JWT config for pg_net (same as AdMob auto-sync).
                    </>
                  )}
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Run at — hour (UTC)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  value={autoRunHourUtc}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isNaN(v)) {
                      setAutoRunHourUtc(0);
                      return;
                    }
                    setAutoRunHourUtc(Math.min(23, Math.max(0, v)));
                  }}
                  disabled={!autoExecuteMonthly}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Run at — minute (UTC)
                </label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={1}
                  value={autoRunMinuteUtc}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isNaN(v)) {
                      setAutoRunMinuteUtc(0);
                      return;
                    }
                    setAutoRunMinuteUtc(Math.min(59, Math.max(0, v)));
                  }}
                  disabled={!autoExecuteMonthly}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20 disabled:opacity-50"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Earliest first automation (optional, UTC)
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Leave blank to allow automation immediately. When set, automated runs are skipped until this date and
                  time in UTC.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="date"
                    value={autoNotBeforeDateUtc}
                    onChange={(e) => setAutoNotBeforeDateUtc(e.target.value)}
                    disabled={!autoExecuteMonthly}
                    className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20 disabled:opacity-50"
                  />
                  <input
                    type="time"
                    step={60}
                    value={autoNotBeforeTimeUtc}
                    onChange={(e) => setAutoNotBeforeTimeUtc(e.target.value)}
                    disabled={!autoExecuteMonthly}
                    className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleUpdateConversionRate}
                disabled={processing}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors"
              >
                {processing ? 'Updating...' : 'Save conversion settings'}
              </button>
              <button
                onClick={() => {
                  setEditingSettings(false);
                  if (settings) {
                    setNewConversionRate(settings.conversion_rate.toString());
                    setRateDescription(settings.conversion_rate_description || '');
                    setNewPlatformPoolPct(
                      String(
                        typeof settings.platform_to_pool_percentage === 'number'
                          ? settings.platform_to_pool_percentage
                          : 15
                      )
                    );
                    setAutoExecuteMonthly(!!settings.auto_execute_monthly_conversion);
                    const rh =
                      typeof settings.auto_conversion_run_hour_utc === 'number'
                        ? settings.auto_conversion_run_hour_utc
                        : 7;
                    const rm =
                      typeof settings.auto_conversion_run_minute_utc === 'number'
                        ? settings.auto_conversion_run_minute_utc
                        : 0;
                    setAutoRunHourUtc(rh);
                    setAutoRunMinuteUtc(rm);
                    const nb2 = utcPartsFromIso(settings.auto_conversion_not_before_utc);
                    setAutoNotBeforeDateUtc(nb2.date);
                    setAutoNotBeforeTimeUtc(nb2.time);
                  }
                }}
                disabled={processing}
                className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Current Period Preview */}
      {preview && (
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <Eye className="w-5 h-5 text-[#309605]" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Current Period Preview</h3>
              <p className="text-xs text-gray-500">Real-time overview of eligible contributions</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
            <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <Zap className="w-5 h-5 text-blue-600" />
                <span className="text-xs font-medium text-blue-600 uppercase tracking-wider">Points</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{preview.total_eligible_points.toLocaleString()}</p>
              <p className="text-xs text-gray-600 mt-0.5">Eligible</p>
            </div>

            <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <Users className="w-5 h-5 text-green-600" />
                <span className="text-xs font-medium text-green-600 uppercase tracking-wider">Users</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{preview.eligible_users_count}</p>
              <p className="text-xs text-gray-600 mt-0.5">Qualified</p>
            </div>

            <div className="p-4 bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <DollarSign className="w-5 h-5 text-orange-600" />
                <span className="text-xs font-medium text-orange-600 uppercase tracking-wider">Estimated</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">${preview.estimated_payout_usd.toFixed(2)}</p>
              <p className="text-xs text-gray-600 mt-0.5">At current rate</p>
            </div>

            <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <TrendingUp className="w-5 h-5 text-[#309605]" />
                <span className="text-xs font-medium text-[#309605] uppercase tracking-wider">Rate</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{preview.conversion_rate}</p>
              <p className="text-xs text-gray-600 mt-0.5">USD/point</p>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-800">
                <strong>Note:</strong>{' '}
                {selfServiceEnabled ? (
                  <>
                    The configured rate is a reference only. With self-service on, actual payouts are{' '}
                    <strong>pool-proportional</strong> — each user&apos;s share = (their weighted points ÷ total
                    outstanding) × pool remaining, capped by the funded pool balance below (AdMob + external topups).
                  </>
                ) : (
                  <>
                    This is an estimate at the current conversion rate. Actual payouts may vary if proportional scaling
                    is applied based on the reward pool amount.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Process Conversion / Listener Rewards Pool */}
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <PlayCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {selfServiceEnabled ? 'Listener Rewards Pool' : 'Process Monthly Conversion'}
            </h3>
            <p className="text-xs text-gray-500">
              {selfServiceEnabled
                ? 'Pool funded from locked AdMob days (automatic) and External Revenue topups (manual apply)'
                : 'Execute the conversion and distribute rewards'}
            </p>
          </div>
        </div>

        {selfServiceEnabled && (
          <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
            <p className="text-sm font-medium text-emerald-900 mb-2">Self-service conversion is ON</p>
            <p className="text-sm text-emerald-800">
              Admin batch conversion is disabled. The listener pool is funded from two sources: locked AdMob days{' '}
              {settings?.auto_fund_pool_from_admob !== false ? (
                <strong>automatically</strong>
              ) : (
                <strong>via manual catch-up</strong>
              )}{' '}
              (on lock + daily 04:15 UTC), and External Revenue distributions (pending topups — apply manually below).
              Users convert from their Earnings tab when they have enough Listener Score points.
            </p>
            {poolStatus?.has_active_pool ? (
              <>
                {poolStatus.period_start && poolStatus.period_end && (
                  <p className="mt-2 text-xs text-emerald-700">
                    Active pool period:{' '}
                    <strong>
                      {poolStatus.period_start} — {poolStatus.period_end}
                    </strong>
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-emerald-700">Funded</p>
                    <p className="font-semibold text-emerald-900">${formatPoolUsd(poolStatus.funded_usd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-emerald-700">Remaining</p>
                    <p className="font-semibold text-emerald-900">${formatPoolUsd(poolStatus.remaining_usd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-emerald-700">Distributed</p>
                    <p className="font-semibold text-emerald-900">${formatPoolUsd(poolStatus.distributed_usd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-emerald-700">Weighted points outstanding</p>
                    <p className="font-semibold text-emerald-900">
                      {(poolStatus.platform_weighted_outstanding ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>
                {poolFundingBreakdown && (
                  <p className="mt-2 text-xs text-emerald-700">
                    Applied this month: AdMob <strong>${formatPoolUsd(poolFundingBreakdown.admobFundedUsd)}</strong>
                    {' + '}
                    External <strong>${formatPoolUsd(poolFundingBreakdown.externalFundedUsd)}</strong>
                  </p>
                )}
                {pendingExternalUsd > 0 && (
                  <p className="mt-2 text-xs text-violet-800">
                    <strong>{pendingExternalCount}</strong> pending external topup(s) (
                    <strong>${formatPoolUsd(pendingExternalUsd)}</strong>) — not in the pool until you apply them below.
                  </p>
                )}
                {(poolStatus.remaining_usd ?? 0) > 0 && (poolStatus.remaining_usd ?? 0) < 0.01 && (
                  <p className="mt-3 text-sm text-amber-800 font-medium">
                    Pool is funded but the balance is very low (sub-cent). Users cannot convert meaningful amounts until
                    more AdMob days are locked or external topups are applied — see the funding forecast below.
                  </p>
                )}
                {(poolStatus.remaining_usd ?? 0) <= 0 && (poolStatus.funded_usd ?? 0) <= 0 && (
                  <p className="mt-3 text-sm text-amber-800 font-medium">
                    Pool exists for this month but has no balance yet — lock AdMob days in Ad Revenue, distribute
                    External Revenue with listener pool allocation, or run catch-up / apply topups below.
                  </p>
                )}
                {(poolStatus.platform_weighted_outstanding ?? 0) > 0 &&
                  (poolStatus.effective_rate_if_all_weighted_converted ?? 0) > 0 &&
                  settings?.conversion_rate != null &&
                  poolStatus.effective_rate_if_all_weighted_converted! < settings.conversion_rate * 0.1 && (
                    <p className="mt-2 text-xs text-amber-800">
                      Effective pool rate (~$
                      {poolStatus.effective_rate_if_all_weighted_converted!.toFixed(6)}/weighted point) is far below
                      the configured conversion rate (${settings.conversion_rate}/point) because demand exceeds pool
                      funding.
                    </p>
                  )}
              </>
            ) : (
              <p className="mt-2 text-sm text-amber-800 font-medium">
                Pool not funded yet — lock AdMob days in Ad Revenue, distribute External Revenue with listener pool
                allocation, or use catch-up / apply topups below.
              </p>
            )}
          </div>
        )}

        <div className="space-y-4">
          {selfServiceEnabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Pool month (forecast, catch-up &amp; topups)
              </label>
              <input
                type="month"
                value={poolMonthValue}
                onChange={(e) => handlePoolMonthChange(e.target.value)}
                className="w-full max-w-xs px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
              />
              <p className="text-xs text-gray-500 mt-1">
                AdMob forecast uses <strong>locked days only</strong> in this calendar month. External Revenue topups are
                created when you distribute External Revenue with listener pool allocation — apply them manually below.
              </p>
            </div>
          )}

          {!selfServiceEnabled && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Conversion Date
              </label>
              <input
                type="date"
                value={conversionDate}
                onChange={(e) => setConversionDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Reward Pool (USD)
              </label>
              <input
                type="number"
                step="0.01"
                value={rewardPoolAmount}
                onChange={(e) => setRewardPoolAmount(e.target.value)}
                placeholder="e.g., 5000"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
              />
            </div>
          </div>
          )}

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">
                {selfServiceEnabled
                  ? 'Pool funding forecast (AdMob + External Revenue)'
                  : 'Suggested listener pool (AdMob + external topups)'}
              </p>
              {poolSuggestionLoading && (
                <RefreshCw className="w-4 h-4 text-gray-500 animate-spin shrink-0" />
              )}
            </div>
            {selfServiceEnabled && (
              <p className="text-xs text-slate-700">
                <strong>AdMob (automatic):</strong> locked days auto-fund via usable net × platform share × pool %.{' '}
                <strong>External Revenue (manual):</strong> distributing external revenue with listener pool allocation
                creates pending topups — apply with the button below. Neither source pays users directly; both fill the
                pool for self-service conversion.
              </p>
            )}
            {poolSuggestion?.error && (
              <p className="text-sm text-red-600">{poolSuggestion.error}</p>
            )}
            {!poolSuggestionLoading && poolSuggestion && !poolSuggestion.error && (
              <>
                <p className="text-xs text-gray-600">
                  Calendar month:{' '}
                  <strong>
                    {poolSuggestion.period_start} — {poolSuggestion.period_end}
                  </strong>
                  . Uses <code className="text-[11px] bg-white px-1 rounded">ad_daily_revenue_input</code>{' '}
                  <strong>locked</strong> rows, usable net per day (gross × safety buffer %), platform share from{' '}
                  <strong>Ad Safety Caps</strong>. Locked AdMob days in range:{' '}
                  <strong>{poolSuggestion.admob_days_count ?? 0}</strong>.
                </p>
                {poolSuggestion.caps_missing && (
                  <p className="text-sm text-amber-800">
                    No active Ad Safety Caps row — configure it under Ad Management before using this forecast.
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Usable net (locked)</p>
                    <p className="font-semibold text-gray-900">
                      ${formatPoolUsd(poolSuggestion.usable_net_total_usd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Platform share</p>
                    <p className="font-semibold text-gray-900">
                      ${formatPoolUsd(poolSuggestion.platform_revenue_usd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Pool % (settings)</p>
                    <p className="font-semibold text-gray-900">{poolSuggestion.pool_percentage ?? 15}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Expected AdMob (locked)</p>
                    <p className="font-semibold text-[#309605]">
                      ${formatPoolUsd(poolSuggestion.suggested_pool_usd)}
                    </p>
                  </div>
                </div>
                {selfServiceEnabled && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm p-3 bg-violet-50/60 border border-violet-100 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-500">Pending external (manual)</p>
                      <p className="font-semibold text-violet-900">${formatPoolUsd(pendingExternalUsd)}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {pendingExternalCount > 0
                          ? `${pendingExternalCount} topup(s) awaiting apply`
                          : 'From External Revenue distributions'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Combined pool target</p>
                      <p className="font-semibold text-gray-900">${formatPoolUsd(combinedSuggestedPoolUsd)}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">AdMob expected + pending external</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Sources</p>
                      <p className="text-sm font-medium text-gray-800">AdMob auto · External manual</p>
                    </div>
                  </div>
                )}
                {selfServiceEnabled && isViewingActivePoolMonth && activePoolFundedUsd != null && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm p-3 bg-white border border-slate-200 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-500">Already funded (total)</p>
                      <p className="font-semibold text-emerald-800">${formatPoolUsd(activePoolFundedUsd)}</p>
                    </div>
                    {poolFundingBreakdown && (
                      <>
                        <div>
                          <p className="text-xs text-gray-500">AdMob applied</p>
                          <p className="font-semibold text-gray-900">
                            ${formatPoolUsd(poolFundingBreakdown.admobFundedUsd)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">External applied</p>
                          <p className="font-semibold text-gray-900">
                            ${formatPoolUsd(poolFundingBreakdown.externalFundedUsd)}
                          </p>
                        </div>
                      </>
                    )}
                    <div>
                      <p className="text-xs text-gray-500">Expected AdMob (locked)</p>
                      <p className="font-semibold text-gray-900">${formatPoolUsd(suggestedPoolUsd)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Pending external</p>
                      <p className="font-semibold text-violet-900">${formatPoolUsd(pendingExternalUsd)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">AdMob catch-up gap</p>
                      <p
                        className={`font-semibold ${
                          (admobCatchUpGapUsd ?? 0) > 0 ? 'text-amber-800' : 'text-emerald-800'
                        }`}
                      >
                        ${formatPoolUsd(admobCatchUpGapUsd ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Gap to full target</p>
                      <p
                        className={`font-semibold ${
                          (totalPoolFundingGapUsd ?? 0) > 0 ? 'text-amber-800' : 'text-emerald-800'
                        }`}
                      >
                        ${formatPoolUsd(totalPoolFundingGapUsd ?? 0)}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {(totalPoolFundingGapUsd ?? 0) > 0
                          ? 'Catch-up AdMob and/or apply external topups'
                          : 'Funded amount matches combined target'}
                      </p>
                    </div>
                  </div>
                )}
                {selfServiceEnabled && !isViewingActivePoolMonth && (
                  <p className="text-xs text-gray-500">
                    Select the current calendar month to compare funded balance vs this forecast.
                  </p>
                )}
                <div
                  className={`p-3 border rounded-lg text-sm space-y-1 ${
                    pendingExternalUsd > 0
                      ? 'bg-violet-50 border-violet-200 text-violet-900'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                >
                  <p>
                    <strong>{pendingExternalCount}</strong> pending external-revenue topup(s):{' '}
                    <strong>${formatPoolUsd(pendingExternalUsd)}</strong>
                  </p>
                  <p className="text-xs">
                    {pendingExternalUsd > 0 ? (
                      <>
                        Created when you distribute <strong>External Revenue</strong> with listener pool allocation.
                        Manual only — use &quot;Apply external topups&quot; below. Combined pool target:{' '}
                        <strong>${formatPoolUsd(combinedSuggestedPoolUsd)}</strong>
                      </>
                    ) : (
                      <>
                        No pending topups right now. Distribute External Revenue (Contribution System → External
                        Revenue) with listener pool allocation to create them.
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                {!selfServiceEnabled && (
                <button
                  type="button"
                  onClick={() =>
                    setRewardPoolAmount(
                      (poolSuggestion.suggested_pool_usd ?? 0).toFixed(2)
                    )
                  }
                  disabled={
                    poolSuggestionLoading ||
                    (poolSuggestion.suggested_pool_usd ?? 0) <= 0 ||
                    !!poolSuggestion.caps_missing
                  }
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium"
                >
                  Use AdMob suggested amount
                </button>
                )}
                {!selfServiceEnabled && (poolSuggestion.combined_suggested_pool_usd ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setRewardPoolAmount((poolSuggestion.combined_suggested_pool_usd ?? 0).toFixed(2));
                    }}
                    disabled={
                      poolSuggestionLoading ||
                      ((poolSuggestion.suggested_pool_usd ?? 0) <= 0 && (poolSuggestion.pending_external_revenue_topup_usd ?? 0) <= 0) ||
                      !!poolSuggestion.caps_missing
                    }
                    className="px-4 py-2 bg-violet-700 hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium"
                  >
                    Use AdMob + external topups
                  </button>
                )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => void handleAdmobPoolCatchUp()}
                    disabled={poolSuggestionLoading || fundingPool || !!poolSuggestion?.caps_missing}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium inline-flex items-center gap-2"
                  >
                    {fundingPool ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="w-4 h-4" />
                    )}
                    Run AdMob catch-up now
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleFundExternalTopups()}
                    disabled={poolSuggestionLoading || fundingTopups || pendingExternalUsd <= 0}
                    className="px-4 py-2 bg-violet-700 hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium inline-flex items-center gap-2"
                  >
                    {fundingTopups ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <DollarSign className="w-4 h-4" />
                    )}
                    Apply external topups
                    {pendingExternalUsd > 0 ? ` ($${formatPoolUsd(pendingExternalUsd)})` : ''}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {selfServiceEnabled ? (
                    <>
                      Two funding sources: locked AdMob days (automatic on lock + daily 04:15 UTC catch-up) and External
                      Revenue topups (manual apply). Catch-up is only for missed AdMob days.
                    </>
                  ) : (
                    <>
                      AdMob funding is automatic on lock and daily at 04:15 UTC. Catch-up is only needed if automation
                      was off or a day was missed.
                    </>
                  )}
                </p>
              </>
            )}
          </div>

          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-yellow-900 text-sm mb-1">Important</p>
                {selfServiceEnabled ? (
                  <ul className="text-sm text-yellow-800 space-y-1">
                    <li>
                      • Pool funded from <strong>two sources</strong>: locked AdMob days (automatic) and External Revenue
                      topups (manual apply after distribute)
                    </li>
                    <li>• External topups are created in External Revenue when listener pool allocation is set</li>
                    <li>• Payouts credit users&apos; Live Balance (<code className="text-[11px]">total_earnings</code>), not Treats</li>
                    <li>• Each user converts their own points; payout is capped by pool remaining (rounded down)</li>
                    <li>• Users below the minimum points threshold cannot convert until they earn more</li>
                  </ul>
                ) : (
                  <ul className="text-sm text-yellow-800 space-y-1">
                    <li>• Pending external-revenue listener topups can be included in the reward pool on execute</li>
                    <li>• Rewards credit users&apos; Live Balance (<code className="text-[11px]">total_earnings</code>)</li>
                    <li>• Current period points reset to 0 after conversion for paid users</li>
                    <li>• If total exceeds reward pool, proportional scaling is applied (payouts rounded down)</li>
                    <li>• This action cannot be undone</li>
                  </ul>
                )}
              </div>
            </div>
          </div>

          {!selfServiceEnabled && (
          <button
            onClick={handleProcessConversion}
            disabled={processing || !rewardPoolAmount || !conversionDate}
            className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {processing ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Processing Conversion...
              </>
            ) : (
              <>
                <PlayCircle className="w-5 h-5" />
                Execute Conversion
              </>
            )}
          </button>
          )}
        </div>
      </div>

      {/* Pool Funding History */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Wallet className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Pool Funding History</h3>
              <p className="text-xs text-gray-500">
                Credits into the listener rewards pool from locked AdMob days and external topups
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Credited</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue day</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gross</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform share</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pool %</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Funded</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pool period</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {poolFundingHistory.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                    No pool funding events yet. Lock AdMob days in Ad Revenue or apply external topups.
                  </td>
                </tr>
              ) : (
                poolFundingHistory.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(record.credited_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {record.revenue_date
                        ? new Date(record.revenue_date).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {record.source_label}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.gross_usd != null ? `$${formatPoolUsd(record.gross_usd)}` : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.platform_share_usd != null
                        ? `$${formatPoolUsd(record.platform_share_usd)}`
                        : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.pool_percentage != null ? `${record.pool_percentage}%` : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-emerald-700">
                      ${formatPoolUsd(record.funded_usd)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.pool_period || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Conversion History */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">User Conversion History</h3>
              <p className="text-xs text-gray-500">
                Per-user Listener Score conversions to Live Balance (self-service and batch)
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">When</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Points</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Weighted</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payout</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pool period</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {userConversionHistory.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-sm text-gray-500">
                    No user conversions yet.
                  </td>
                </tr>
              ) : (
                userConversionHistory.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <span className="font-medium">{record.user_label}</span>
                      <span className="block text-xs text-gray-500 font-mono">{record.user_id.slice(0, 8)}…</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {formatConversionType(record.conversion_type)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {record.points.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.weighted_points != null ? record.weighted_points.toLocaleString() : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      ${formatPoolUsd(record.payout_usd)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.effective_rate != null ? record.effective_rate.toFixed(6) : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.pool_period || '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full capitalize">
                        {record.status || 'completed'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch Conversion Runs */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <History className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Batch Conversion Runs</h3>
              <p className="text-xs text-gray-500">Admin-executed monthly conversion batches</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pool</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Points</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Users</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Distributed</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scaling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                    No batch conversion runs yet.
                  </td>
                </tr>
              ) : (
                history.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(record.conversion_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${record.reward_pool_usd.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {record.total_points_converted.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {record.total_users_paid}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      ${record.total_distributed_usd.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.actual_rate_applied.toFixed(6)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {record.scaling_applied ? (
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
                          Applied
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                          No
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* How It Works */}
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Info className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-base">How Monthly Conversion Works</h3>
            <p className="text-xs text-gray-600 mt-0.5">Step-by-step process</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
              <h4 className="font-medium text-gray-900 text-sm">Set Conversion Rate</h4>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              Admin configures the conversion rate (e.g., 0.001 USD per point). This determines the base value of each point.
            </p>
          </div>

          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
              <h4 className="font-medium text-gray-900 text-sm">Set reward pool</h4>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              Use <strong>Use suggested amount</strong> to fill the pool from AdMob platform share × your configured %,
              or enter any USD amount manually.
            </p>
          </div>

          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
              <h4 className="font-medium text-gray-900 text-sm">Calculate Payouts</h4>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              System calculates: payout = user_points × rate. If total exceeds pool, proportional scaling is applied.
            </p>
          </div>

          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</div>
              <h4 className="font-medium text-gray-900 text-sm">Distribute & Reset</h4>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              Payouts added to Treat Wallets, current period points reset to 0, ready for next month.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
