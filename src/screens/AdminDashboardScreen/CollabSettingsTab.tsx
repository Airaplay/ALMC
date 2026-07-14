import { useState, useEffect } from 'react';
import { Users, Coins, Settings, TrendingUp, BarChart, DollarSign } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { supabase } from '../../lib/supabase';
import {
  getCollaborationUnlockSettings,
  getCollaborationUnlockAnalytics,
  clearCollaborationUnlockSettingsCache
} from '../../lib/collaborationUnlockService';

export const CollabSettingsTab = () => {
  const [settings, setSettings] = useState({
    is_enabled: true,
    free_matches_count: 3,
    unlock_cost_treats: 10,
    max_unlockable_matches: 1
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    fetchSettings();
    fetchAnalytics();
  }, []);

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const settingsData = await getCollaborationUnlockSettings();

      if (settingsData) {
        setSettings({
          is_enabled: settingsData.isEnabled,
          free_matches_count: settingsData.freeMatchesCount,
          unlock_cost_treats: settingsData.unlockCostTreats,
          max_unlockable_matches: settingsData.maxUnlockableMatches
        });
      }
    } catch (err) {
      console.error('Error fetching collab settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const analyticsData = await getCollaborationUnlockAnalytics(30);
      setAnalytics(analyticsData);
    } catch (err) {
      console.error('Error fetching analytics:', err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;

    if (type === 'checkbox') {
      setSettings(prev => ({
        ...prev,
        [name]: checked
      }));
    } else {
      const numValue = parseInt(value);
      if (!isNaN(numValue) || value === '') {
        setSettings(prev => ({
          ...prev,
          [name]: value === '' ? 0 : numValue
        }));
      }
    }
  };

  const validateSettings = (): string | null => {
    if (settings.free_matches_count < 1 || settings.free_matches_count > 10) {
      return 'Free matches count must be between 1 and 10';
    }

    if (settings.unlock_cost_treats < 1 || settings.unlock_cost_treats > 1000) {
      return 'Unlock cost must be between 1 and 1000 Treats';
    }

    if (settings.max_unlockable_matches < 1 || settings.max_unlockable_matches > 10) {
      return 'Max unlockable matches must be between 1 and 10';
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateSettings();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Authentication required');
      }

      const { error: updateError } = await supabase
        .from('collaboration_unlock_settings')
        .update({
          is_enabled: settings.is_enabled,
          free_matches_count: settings.free_matches_count,
          unlock_cost_treats: settings.unlock_cost_treats,
          max_unlockable_matches: settings.max_unlockable_matches,
          updated_by: user.id,
          updated_at: new Date().toISOString()
        })
        .eq('singleton_key', true);

      if (updateError) {
        throw new Error(`Failed to save settings: ${updateError.message}`);
      }

      clearCollaborationUnlockSettingsCache();
      setSuccess('Collaboration unlock settings saved successfully');

      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error saving settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#309605]/30 border-t-[#309605] rounded-full animate-spin" />
      </div>
    );
  }

  const inputCls = "w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1.5";

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
          <Settings className="w-4 h-4 text-[#309605]" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Collaboration Unlock Settings</h2>
          <p className="text-sm text-gray-400 mt-0.5">Configure Treat-based collaboration match unlock feature</p>
        </div>
      </div>

      {/* Analytics Cards */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Unlocks', value: analytics.totalUnlocks, icon: <TrendingUp className="w-4 h-4 text-[#309605]" />, bg: 'bg-green-50' },
            { label: 'Total Revenue', value: `${analytics.totalRevenue} T`, icon: <Coins className="w-4 h-4 text-yellow-600" />, bg: 'bg-yellow-50' },
            { label: 'Unique Users', value: analytics.uniqueUsers, icon: <Users className="w-4 h-4 text-blue-600" />, bg: 'bg-blue-50' },
            { label: 'Avg per User', value: `${analytics.uniqueUsers > 0 ? Math.round(analytics.totalRevenue / analytics.uniqueUsers) : 0} T`, icon: <DollarSign className="w-4 h-4 text-[#309605]" />, bg: 'bg-green-50' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500">{stat.label}</p>
                <div className={`w-6 h-6 rounded-md ${stat.bg} flex items-center justify-center`}>{stat.icon}</div>
              </div>
              <p className="text-xl font-bold text-gray-900">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Settings Form */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div>
                <p className="text-sm font-semibold text-gray-900">Enable Unlock Feature</p>
                <p className="text-xs text-gray-400 mt-0.5">Allow users to unlock additional collaboration matches with Treats</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" name="is_enabled" checked={settings.is_enabled} onChange={handleInputChange} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#309605]"></div>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Free Matches Count <span className="text-gray-400 font-normal">(1-10)</span></label>
                <p className="text-xs text-gray-400 mb-1.5">Matches shown for free before unlock required</p>
                <input type="number" name="free_matches_count" value={settings.free_matches_count} onChange={handleInputChange} min="1" max="10" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Unlock Cost (Treats) <span className="text-gray-400 font-normal">(1-1000)</span></label>
                <p className="text-xs text-gray-400 mb-1.5">Cost in Treats to unlock additional matches</p>
                <div className="relative">
                  <input type="number" name="unlock_cost_treats" value={settings.unlock_cost_treats} onChange={handleInputChange} min="1" max="1000"
                    className="w-full px-3 py-2 pr-16 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent" />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-gray-400">
                    <Coins className="w-3.5 h-3.5" />
                    <span className="text-xs">T</span>
                  </div>
                </div>
              </div>
              <div>
                <label className={labelCls}>Max Unlockable <span className="text-gray-400 font-normal">(1-10)</span></label>
                <p className="text-xs text-gray-400 mb-1.5">Max additional matches per rotation period</p>
                <input type="number" name="max_unlockable_matches" value={settings.max_unlockable_matches} onChange={handleInputChange} min="1" max="10" className={inputCls} />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            {success && (
              <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                <p className="text-sm text-green-700">{success}</p>
              </div>
            )}

            <div className="flex justify-end">
              <button type="submit" disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {isSubmitting ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</>
                ) : (
                  <><Settings className="w-3.5 h-3.5" />Save Settings</>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Preview */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart className="w-4 h-4 text-[#309605]" />
            <p className="text-sm font-semibold text-gray-900">Current Configuration</p>
          </div>
          <div className="space-y-0 divide-y divide-gray-50">
            {[
              { label: 'Feature Status', value: settings.is_enabled ? 'Enabled' : 'Disabled', color: settings.is_enabled ? 'text-[#309605]' : 'text-red-500' },
              { label: 'Free Matches', value: `${settings.free_matches_count} matches` },
              { label: 'Unlock Price', value: `${settings.unlock_cost_treats} Treats` },
              { label: 'Max Unlockable', value: `${settings.max_unlockable_matches} match${settings.max_unlockable_matches !== 1 ? 'es' : ''}` },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2.5">
                <span className="text-xs text-gray-500">{row.label}</span>
                <span className={`text-xs font-medium ${row.color || 'text-gray-900'}`}>{row.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
            <p className="text-xs text-blue-700"><strong>Note:</strong> Changes apply to new rotation periods. Active unlocks remain until next 6-hour refresh.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
