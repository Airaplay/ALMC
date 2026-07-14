import { useState, useEffect } from 'react';
import { Calendar, Gift, Save, RefreshCw, Power, Monitor, TrendingUp, Zap, Award, Users, AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

interface CheckinConfig {
  id: string;
  day_number: number;
  treat_reward: number;
  is_bonus_day: boolean;
  ad_enabled: boolean;
}

interface CheckinSettings {
  id: string;
  feature_enabled: boolean;
  ad_provider: 'admob' | 'unity' | 'custom' | 'none';
  ad_unit_id: string | null;
}

interface CheckinStats {
  totalCheckins: number;
  activeStreaks: number;
  avgStreak: number;
  todayCheckins: number;
}

export const DailyCheckinSection = () => {
  const [configs, setConfigs] = useState<CheckinConfig[]>([]);
  const [settings, setSettings] = useState<CheckinSettings>({
    id: '',
    feature_enabled: true,
    ad_provider: 'admob',
    ad_unit_id: null
  });
  const [stats, setStats] = useState<CheckinStats>({
    totalCheckins: 0,
    activeStreaks: 0,
    avgStreak: 0,
    todayCheckins: 0
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      await Promise.all([loadConfigs(), loadSettings(), loadStats()]);
    } catch (error) {
      console.error('Error loading daily check-in data:', error);
      setError('Failed to load check-in data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadConfigs = async () => {
    const { data, error } = await supabase
      .from('daily_checkin_config')
      .select('*')
      .order('day_number');

    if (error) {
      console.error('Error loading configs:', error);
      throw error;
    }

    setConfigs(data || []);
  };

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from('daily_checkin_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error loading settings:', error);
      throw error;
    }

    if (data) {
      setSettings(data);
    }
  };

  const loadStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];

      const [totalResult, streaksResult, todayResult] = await Promise.all([
        supabase
          .from('daily_checkin_history')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('user_checkin_streaks')
          .select('current_streak'),
        supabase
          .from('daily_checkin_history')
          .select('id', { count: 'exact', head: true })
          .eq('checkin_date', today)
      ]);

      const activeStreaks = streaksResult.data?.filter(s => s.current_streak > 0).length || 0;
      const avgStreak = streaksResult.data?.length
        ? streaksResult.data.reduce((sum, s) => sum + s.current_streak, 0) / streaksResult.data.length
        : 0;

      setStats({
        totalCheckins: totalResult.count || 0,
        activeStreaks,
        avgStreak: Math.round(avgStreak * 10) / 10,
        todayCheckins: todayResult.count || 0
      });
    } catch (error) {
      console.error('Error loading stats:', error);
      throw error;
    }
  };

  const handleConfigChange = (dayNumber: number, field: keyof CheckinConfig, value: any) => {
    setConfigs(prev =>
      prev.map(config =>
        config.day_number === dayNumber
          ? { ...config, [field]: value }
          : config
      )
    );
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSaveSuccess(false);

      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('You must be logged in to save settings');
      }

      if (!settings.id) {
        throw new Error('Settings not loaded properly');
      }

      const { error: settingsError } = await supabase
        .from('daily_checkin_settings')
        .update({
          feature_enabled: settings.feature_enabled,
          ad_provider: settings.ad_provider,
          ad_unit_id: settings.ad_unit_id,
          updated_by: user.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', settings.id);

      if (settingsError) {
        console.error('Settings update error:', settingsError);
        throw new Error(`Failed to update settings: ${settingsError.message}`);
      }

      for (const config of configs) {
        const { error } = await supabase
          .from('daily_checkin_config')
          .update({
            treat_reward: config.treat_reward,
            is_bonus_day: config.is_bonus_day,
            ad_enabled: config.ad_enabled
          })
          .eq('day_number', config.day_number);

        if (error) {
          console.error(`Config update error for day ${config.day_number}:`, error);
          throw new Error(`Failed to update day ${config.day_number}: ${error.message}`);
        }
      }

      setSaveSuccess(true);
      await loadData();

      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    } catch (error: any) {
      console.error('Error saving configs:', error);
      setError(error.message || 'Failed to save configuration. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingLogo variant="pulse" size={32} />
        <p className="ml-4 text-gray-700">Loading daily check-in data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Daily Check-in Manager</h2>
            <p className="text-sm text-gray-400 mt-0.5">Configure daily check-in rewards and settings</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Success/Error Messages */}
      {saveSuccess && (
        <div className="p-4 bg-green-100 border border-green-200 rounded-lg flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <p className="text-green-700">Configuration saved successfully!</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-100 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-700 font-medium">Total Check-ins</h3>
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.totalCheckins.toLocaleString()}</p>
          <p className="text-sm text-gray-600 mt-1">All time</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-700 font-medium">Active Streaks</h3>
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <Zap className="w-5 h-5 text-green-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.activeStreaks}</p>
          <p className="text-sm text-gray-600 mt-1">Users with streaks</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-700 font-medium">Average Streak</h3>
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <Award className="w-5 h-5 text-[#309605]" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.avgStreak}</p>
          <p className="text-sm text-gray-600 mt-1">days per user</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-700 font-medium">Today's Check-ins</h3>
            <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-yellow-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{stats.todayCheckins}</p>
          <p className="text-sm text-gray-600 mt-1">Today</p>
        </div>
      </div>

      {/* Global Settings - Two Column Layout */}
      <div className="grid grid-cols-2 gap-6">
        {/* Feature Control Card */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#309605] flex items-center justify-center">
                <Power className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Feature Control</h3>
                <p className="text-sm text-gray-600">Global feature management</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between p-5 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-3">
                <div className={`w-14 h-14 rounded-lg flex items-center justify-center transition-colors ${
                  settings.feature_enabled ? 'bg-[#309605] bg-opacity-20' : 'bg-gray-200'
                }`}>
                  <Power className={`w-7 h-7 ${settings.feature_enabled ? 'text-[#309605]' : 'text-gray-400'}`} />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-gray-900 mb-1">Daily Check-in Feature</h4>
                  <p className="text-sm text-gray-600">Enable or disable globally</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.feature_enabled}
                  onChange={(e) => setSettings(prev => ({ ...prev, feature_enabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-16 h-8 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#309605] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-7 after:w-7 after:transition-all peer-checked:bg-[#309605]"></div>
              </label>
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h5 className="text-sm font-semibold text-blue-900 mb-1">Status</h5>
                  <p className="text-sm text-blue-800">
                    {settings.feature_enabled
                      ? 'Check-in feature is currently active for all users'
                      : 'Check-in feature is currently disabled'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Ad Configuration Card */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
                <Monitor className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Ad Integration</h3>
                <p className="text-sm text-gray-600">Configure ad provider settings</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Select Ad Provider</label>
              <div className="grid grid-cols-2 gap-3">
                {(['admob', 'unity', 'custom', 'none'] as const).map((provider) => (
                  <button
                    key={provider}
                    onClick={() => setSettings(prev => ({ ...prev, ad_provider: provider }))}
                    className={`px-4 py-3 rounded-lg border-2 transition-all font-medium ${
                      settings.ad_provider === provider
                        ? 'border-[#309605] bg-[#309605] bg-opacity-10 text-[#309605]'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-[#309605] hover:bg-gray-50'
                    }`}
                  >
                    {provider === 'admob' && 'AdMob'}
                    {provider === 'unity' && 'Unity Ads'}
                    {provider === 'custom' && 'Custom'}
                    {provider === 'none' && 'None'}
                  </button>
                ))}
              </div>
            </div>

            {settings.ad_provider !== 'none' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ad Unit ID <span className="text-gray-500">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={settings.ad_unit_id || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, ad_unit_id: e.target.value || null }))}
                  placeholder="Enter ad unit ID"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#309605] focus:ring-2 focus:ring-[#309605] focus:ring-opacity-20"
                />
                <p className="mt-2 text-xs text-gray-500">Used for tracking and monetization</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 7-Day Reward Configuration */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500 flex items-center justify-center">
              <Gift className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">7-Day Reward Configuration</h3>
              <p className="text-sm text-gray-600">Customize rewards for each day of the streak</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-4">
            {configs.map((config) => (
              <div
                key={config.day_number}
                className={`border rounded-lg p-6 transition-all ${
                  config.is_bonus_day
                    ? 'border-yellow-400 bg-yellow-50'
                    : 'border-gray-200 bg-white hover:border-[#309605] hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-6">
                  <div className="flex-shrink-0">
                    <div className={`w-16 h-16 rounded-xl flex items-center justify-center font-bold text-xl shadow-md ${
                      config.is_bonus_day
                        ? 'bg-yellow-500 text-white'
                        : 'bg-[#309605] text-white'
                    }`}>
                      {config.is_bonus_day ? <Gift className="w-8 h-8" /> : `D${config.day_number}`}
                    </div>
                  </div>

                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-6">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Treat Reward Amount
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          value={config.treat_reward}
                          onChange={(e) =>
                            handleConfigChange(config.day_number, 'treat_reward', parseInt(e.target.value) || 0)
                          }
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 font-semibold text-lg focus:outline-none focus:border-[#309605] focus:ring-2 focus:ring-[#309605] focus:ring-opacity-20"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">treats</span>
                      </div>
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2.5 cursor-pointer w-full px-4 py-3 rounded-lg hover:bg-white/50 transition-colors border border-transparent hover:border-gray-200">
                        <input
                          type="checkbox"
                          checked={config.is_bonus_day}
                          onChange={(e) =>
                            handleConfigChange(config.day_number, 'is_bonus_day', e.target.checked)
                          }
                          className="w-5 h-5 rounded border-gray-300 text-yellow-500 focus:ring-yellow-500"
                        />
                        <Award className="w-5 h-5 text-yellow-600" />
                        <span className="text-sm font-semibold text-gray-900">Bonus Day</span>
                      </label>
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2.5 cursor-pointer w-full px-4 py-3 rounded-lg hover:bg-white/50 transition-colors border border-transparent hover:border-gray-200">
                        <input
                          type="checkbox"
                          checked={config.ad_enabled}
                          onChange={(e) =>
                            handleConfigChange(config.day_number, 'ad_enabled', e.target.checked)
                          }
                          className="w-5 h-5 rounded border-gray-300 text-[#309605] focus:ring-[#309605]"
                        />
                        <Monitor className="w-5 h-5 text-[#309605]" />
                        <span className="text-sm font-semibold text-gray-900">Show Ad</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Best Practices */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Users className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-blue-900 mb-2">Configuration Best Practices</h4>
                <ul className="text-sm text-blue-800 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Increase rewards progressively to encourage longer streaks</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Mark Day 7 as a bonus day for special rewards</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Enable ads to monetize check-ins (can be toggled per day)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Consider offering 50+ treats on Day 7 to motivate users</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
