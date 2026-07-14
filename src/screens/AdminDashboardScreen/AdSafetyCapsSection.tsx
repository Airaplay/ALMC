import { useState, useEffect } from 'react';
import { Shield, DollarSign, Clock, TrendingUp, Save, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface SafetyCaps {
  id: string;
  max_rewarded_ads_per_day: number;
  max_listener_earnings_per_day_usd: number;
  min_lqs_for_listener_reward: number;
  min_playback_duration_seconds: number;
  pending_balance_unlock_hours: number;
  artist_revenue_percentage: number;
  listener_revenue_percentage: number;
  platform_revenue_percentage: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const AdSafetyCapsSection = (): JSX.Element => {
  const [safetyCaps, setSafetyCaps] = useState<SafetyCaps | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    max_rewarded_ads_per_day: 50,
    min_playback_duration_seconds: 65,
    pending_balance_unlock_hours: 168,
    artist_revenue_percentage: 50.00,
    platform_revenue_percentage: 50.00,
  });

  useEffect(() => {
    fetchSafetyCaps();
  }, []);

  const fetchSafetyCaps = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('ad_safety_caps')
        .select('*')
        .eq('is_active', true)
        .single();

      if (fetchError) throw fetchError;

      if (data) {
        setSafetyCaps(data);
        setFormData({
          max_rewarded_ads_per_day: data.max_rewarded_ads_per_day,
          min_playback_duration_seconds: data.min_playback_duration_seconds,
          pending_balance_unlock_hours: data.pending_balance_unlock_hours,
          artist_revenue_percentage: parseFloat(data.artist_revenue_percentage),
          platform_revenue_percentage: parseFloat(data.platform_revenue_percentage),
        });
      }
    } catch (err: any) {
      console.error('Error fetching safety caps:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: keyof typeof formData, value: number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
    setSuccess(null);
    setError(null);
  };

  const validateForm = (): string | null => {
    // Validate revenue split totals to 100%
    const total = formData.artist_revenue_percentage + formData.platform_revenue_percentage;

    if (Math.abs(total - 100) > 0.01) {
      return `Revenue split must total 100%. Currently: ${total.toFixed(2)}%`;
    }

    // Ensure creators get at least 50% (AdMob compliance)
    if (formData.artist_revenue_percentage < 50) {
      return 'Artist/Creator revenue must be at least 50% for AdMob policy compliance';
    }

    // Validate ranges
    if (formData.max_rewarded_ads_per_day < 1 || formData.max_rewarded_ads_per_day > 200) {
      return 'Max rewarded ads per day must be between 1 and 200';
    }

    if (formData.min_playback_duration_seconds < 1 || formData.min_playback_duration_seconds > 300) {
      return 'Minimum playback duration must be between 1 and 300 seconds';
    }

    if (formData.pending_balance_unlock_hours < 0 || formData.pending_balance_unlock_hours > 720) {
      return 'Pending unlock hours must be between 0 and 720 (30 days)';
    }

    if (formData.artist_revenue_percentage < 0 || formData.artist_revenue_percentage > 100) {
      return 'Artist percentage must be between 0 and 100';
    }

    if (formData.platform_revenue_percentage < 0 || formData.platform_revenue_percentage > 100) {
      return 'Platform percentage must be between 0 and 100';
    }

    return null;
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);

      // Validate
      const validationError = validateForm();
      if (validationError) {
        setError(validationError);
        return;
      }

      if (!safetyCaps) {
        setError('No active safety caps configuration found');
        return;
      }

      // Update via secure RPC that enforces admin-only access and validates split
      const { data: rpcResult, error: updateError } = await supabase.rpc(
        'admin_update_ad_safety_caps',
        {
          p_id: safetyCaps.id,
          p_max_rewarded_ads_per_day: formData.max_rewarded_ads_per_day,
          p_min_playback_duration_seconds: formData.min_playback_duration_seconds,
          p_pending_balance_unlock_hours: formData.pending_balance_unlock_hours,
          p_artist_revenue_percentage: formData.artist_revenue_percentage,
          p_platform_revenue_percentage: formData.platform_revenue_percentage,
        }
      );

      if (updateError) throw updateError;
      if (rpcResult && !rpcResult.success) {
        throw new Error(rpcResult.error || 'Failed to update safety caps');
      }

      setSuccess('Safety caps and revenue split updated successfully!');
      setIsDirty(false);
      fetchSafetyCaps(); // Refresh data
    } catch (err: any) {
      console.error('Error saving safety caps:', err);
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (safetyCaps) {
      setFormData({
        max_rewarded_ads_per_day: safetyCaps.max_rewarded_ads_per_day,
        min_playback_duration_seconds: safetyCaps.min_playback_duration_seconds,
        pending_balance_unlock_hours: safetyCaps.pending_balance_unlock_hours,
        artist_revenue_percentage: parseFloat(safetyCaps.artist_revenue_percentage),
        platform_revenue_percentage: parseFloat(safetyCaps.platform_revenue_percentage),
      });
      setIsDirty(false);
      setError(null);
      setSuccess(null);
    }
  };

  const getTotalRevenueSplit = () => {
    return formData.artist_revenue_percentage + formData.platform_revenue_percentage;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        {null}
      </div>
    );
  }

  const inputCls = "w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1.5";

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Ad Safety Caps</h2>
            <p className="text-sm text-gray-400 mt-0.5">Configure revenue limits and AdMob-compliant monetization settings</p>
          </div>
        </div>

        {/* Monetization Model Notice */}
        <div className="bg-green-50 border border-green-100 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertCircle className="w-4 h-4 text-green-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900 mb-1.5">AdMob-Compliant Monetization Model</p>
              <div className="space-y-1 text-xs text-gray-600">
                <p className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-green-600 rounded-full flex-shrink-0"></span><strong>Ad Revenue Split:</strong> 50% Creators | 0% Listeners | 50% Platform</p>
                <p className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-green-600 rounded-full flex-shrink-0"></span><strong>Listener Earnings:</strong> Through Contribution Rewards (separate from ad revenue)</p>
                <p className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-green-600 rounded-full flex-shrink-0"></span><strong>Compliance:</strong> Meets AdMob policies (creators get 60% minimum)</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-50 border border-green-100 rounded-lg flex items-start gap-2.5">
          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily Limits */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Daily User Limits</p>
              <p className="text-xs text-gray-400">Prevent abuse and control payouts</p>
            </div>
          </div>
          <label className={labelCls}>Max Rewarded Ads Per Day</label>
          <input type="number" min="1" max="200" value={formData.max_rewarded_ads_per_day}
            onChange={(e) => handleChange('max_rewarded_ads_per_day', parseInt(e.target.value))}
            className={inputCls} />
          <p className="text-xs text-gray-400 mt-1.5">Maximum ads a creator can be rewarded for per day</p>
        </div>

        {/* Quality Thresholds */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-[#309605]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Quality Thresholds</p>
              <p className="text-xs text-gray-400">Ensure genuine engagement</p>
            </div>
          </div>
          <label className={labelCls}>Minimum Playback Duration (Seconds)</label>
          <input type="number" min="1" max="300" value={formData.min_playback_duration_seconds}
            onChange={(e) => handleChange('min_playback_duration_seconds', parseInt(e.target.value))}
            className={inputCls} />
          <p className="text-xs text-gray-400 mt-1.5">Seconds of playback required for ad revenue eligibility</p>
        </div>
      </div>

      {/* Pending Balance */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
            <Clock className="w-3.5 h-3.5 text-orange-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Pending Balance Settings</p>
            <p className="text-xs text-gray-400">Fraud prevention and reconciliation window</p>
          </div>
        </div>
        <label className={labelCls}>Pending Balance Unlock Period (Hours)</label>
        <input type="number" min="0" max="720" value={formData.pending_balance_unlock_hours}
          onChange={(e) => handleChange('pending_balance_unlock_hours', parseInt(e.target.value))}
          className={inputCls} />
        <p className="text-xs text-gray-400 mt-1.5">Hours before pending balances become withdrawable. Default: 168 hours (7 days).</p>
      </div>

      {/* Revenue Split */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
            <DollarSign className="w-3.5 h-3.5 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Revenue Split Configuration</p>
            <p className="text-xs text-gray-400">How ad revenue is distributed (must total 100%)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelCls}>Creator Revenue (%)</label>
            <input type="number" min="50" max="100" step="0.01" value={formData.artist_revenue_percentage}
              onChange={(e) => handleChange('artist_revenue_percentage', parseFloat(e.target.value))}
              className={inputCls} />
            <p className="text-xs text-gray-400 mt-1.5">Minimum 50% for AdMob compliance</p>
          </div>
          <div>
            <label className={labelCls}>Platform Revenue (%)</label>
            <input type="number" min="0" max="50" step="0.01" value={formData.platform_revenue_percentage}
              onChange={(e) => handleChange('platform_revenue_percentage', parseFloat(e.target.value))}
              className={inputCls} />
            <p className="text-xs text-gray-400 mt-1.5">Platform share for operations and rewards</p>
          </div>
        </div>

        <div className={`p-3 rounded-lg border ${Math.abs(getTotalRevenueSplit() - 100) < 0.01 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium ${Math.abs(getTotalRevenueSplit() - 100) < 0.01 ? 'text-green-700' : 'text-red-700'}`}>Total Revenue Split</span>
            <span className={`text-lg font-bold ${Math.abs(getTotalRevenueSplit() - 100) < 0.01 ? 'text-green-700' : 'text-red-700'}`}>{getTotalRevenueSplit().toFixed(2)}%</span>
          </div>
          {Math.abs(getTotalRevenueSplit() - 100) >= 0.01 && (
            <p className="text-xs text-red-600 mt-1">Must equal exactly 100%. Currently off by {(getTotalRevenueSplit() - 100).toFixed(2)}%.</p>
          )}
        </div>

        <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-xs font-medium text-blue-800 mb-1.5">Revenue Distribution</p>
          <ul className="space-y-1 text-xs text-gray-600">
            <li className="flex items-start gap-1.5"><span className="text-blue-500 mt-0.5">•</span><span><strong>Creators:</strong> {formData.artist_revenue_percentage}% of all ad revenue</span></li>
            <li className="flex items-start gap-1.5"><span className="text-blue-500 mt-0.5">•</span><span><strong>Platform:</strong> {formData.platform_revenue_percentage}% of all ad revenue</span></li>
            <li className="flex items-start gap-1.5"><span className="text-blue-500 mt-0.5">•</span><span><strong>Listeners:</strong> Earn via Contribution Rewards (separate budget)</span></li>
          </ul>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3">
        <button onClick={handleReset} disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 rounded-lg font-medium transition-colors">
          Reset
        </button>
        <button onClick={handleSave} disabled={!isDirty || isSaving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-[#309605] hover:bg-[#3ba208] disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors">
          <Save className="w-3.5 h-3.5" />
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
};
 
