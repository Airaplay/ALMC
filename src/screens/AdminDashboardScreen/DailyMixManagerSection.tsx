import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, TrendingUp, Users, Play, AlertCircle, CheckCircle, Sparkles, Settings, BarChart2, Info, Calendar, Zap, Target, Award, Sliders, Layers } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface DailyMixConfig {
  id: string;
  enabled: boolean;
  auto_generate: boolean;
  mixes_per_user: number;
  tracks_per_mix: number;
  familiar_ratio: number;
  min_play_duration_seconds: number;
  skip_threshold_seconds: number;
  refresh_hour: number;
  collaborative_filtering_weight: number;
  content_based_weight: number;
  trending_weight: number;
  diversity_bonus: number;
  quality_threshold: number;
}

interface GenerationStats {
  total_mixes: number;
  active_users: number;
  last_generated: string | null;
}

export const DailyMixManagerSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'weights' | 'quality'>('overview');
  const [config, setConfig] = useState<DailyMixConfig | null>(null);
  const [stats, setStats] = useState<GenerationStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalConfig, setOriginalConfig] = useState<DailyMixConfig | null>(null);

  useEffect(() => {
    loadConfig();
    loadStats();
  }, []);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (config && originalConfig) {
      const changed = JSON.stringify(config) !== JSON.stringify(originalConfig);
      setHasUnsavedChanges(changed);
    }
  }, [config, originalConfig]);

  const loadConfig = async () => {
    try {
      setError(null);
      const { data, error: configError } = await supabase
        .from('daily_mix_config')
        .select('*')
        .single();

      if (configError) throw configError;
      setConfig(data);
      setOriginalConfig(data);
    } catch (err) {
      console.error('Error loading config:', err);
      setError('Failed to load configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const { data: mixData, error: mixError } = await supabase
        .from('daily_mix_playlists')
        .select('id, user_id, generated_at', { count: 'exact' })
        .gt('expires_at', new Date().toISOString());

      if (mixError) throw mixError;

      const uniqueUsers = new Set(mixData?.map(m => m.user_id) || []);
      const latestGeneration = mixData && mixData.length > 0
        ? mixData.reduce((latest, mix) => {
            return new Date(mix.generated_at) > new Date(latest)
              ? mix.generated_at
              : latest;
          }, mixData[0].generated_at)
        : null;

      setStats({
        total_mixes: mixData?.length || 0,
        active_users: uniqueUsers.size,
        last_generated: latestGeneration
      });
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { error: updateError } = await supabase
        .from('daily_mix_config')
        .update({
          enabled: config.enabled,
          auto_generate: config.auto_generate,
          mixes_per_user: config.mixes_per_user,
          tracks_per_mix: config.tracks_per_mix,
          familiar_ratio: config.familiar_ratio,
          min_play_duration_seconds: config.min_play_duration_seconds,
          skip_threshold_seconds: config.skip_threshold_seconds,
          refresh_hour: config.refresh_hour,
          collaborative_filtering_weight: config.collaborative_filtering_weight,
          content_based_weight: config.content_based_weight,
          trending_weight: config.trending_weight,
          diversity_bonus: config.diversity_bonus,
          quality_threshold: config.quality_threshold,
          updated_at: new Date().toISOString()
        })
        .eq('id', config.id);

      if (updateError) throw updateError;

      setOriginalConfig(config);
      setHasUnsavedChanges(false);
      setSuccessMessage('Configuration saved successfully');
    } catch (err) {
      console.error('Error saving config:', err);
      setError('Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateMixes = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data, error } = await supabase.rpc('admin_enqueue_daily_mix_generation_now', {
        p_force_refresh: true,
      });

      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.error || 'Failed to enqueue daily mix generation');
      }

      setSuccessMessage(
        `Enqueued ${data.enqueued_jobs || 0} daily mix generation job(s). Generation will run via the queue processor shortly.`
      );
      await loadStats();
    } catch (err) {
      console.error('Error generating mixes:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate mixes');
    } finally {
      setIsGenerating(false);
    }
  };

  const discardChanges = () => {
    if (originalConfig) {
      setConfig(originalConfig);
      setHasUnsavedChanges(false);
    }
  };

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
        <p className="ml-3 text-gray-600">Loading Daily Mix AI configuration...</p>
      </div>
    );
  }

  const totalWeight = config.collaborative_filtering_weight + config.content_based_weight + config.trending_weight;
  const isWeightBalanced = Math.abs(totalWeight - 1.0) < 0.01;

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Layers className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 leading-tight">Daily Mix AI System</h2>
              <p className="text-sm text-gray-400 mt-0.5">Configure and manage AI-generated daily mixes for users</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                loadConfig();
                loadStats();
              }}
              disabled={isLoading}
              className="p-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-lg text-gray-700 transition-colors"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleGenerateMixes}
              disabled={isGenerating || !config.enabled}
              className="px-4 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-sm"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Generate Mixes Now
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'overview'
                ? 'border-[#309605] text-[#309605]'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4" />
              Overview & Stats
            </div>
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'config'
                ? 'border-[#309605] text-[#309605]'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              System Config
            </div>
          </button>
          <button
            onClick={() => setActiveTab('weights')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'weights'
                ? 'border-[#309605] text-[#309605]'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              Recommendation Weights
            </div>
          </button>
          <button
            onClick={() => setActiveTab('quality')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'quality'
                ? 'border-[#309605] text-[#309605]'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4" />
              Quality Filters
            </div>
          </button>
        </div>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 border-l-4 border-green-600 rounded-r-lg flex items-start gap-3 animate-in slide-in-from-top-2">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-green-900 text-sm">Success</p>
            <p className="text-green-700 text-sm">{successMessage}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-600 rounded-r-lg flex items-start gap-3 animate-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-900 text-sm">Error</p>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Unsaved Changes Banner */}
      {hasUnsavedChanges && (
        <div className="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-600 rounded-r-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            <div>
              <p className="font-medium text-yellow-900 text-sm">Unsaved Changes</p>
              <p className="text-yellow-700 text-sm">
                You have unsaved configuration changes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={discardChanges}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium transition-colors"
            >
              Discard Changes
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={isSaving}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div>
          {/* Stats Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <TrendingUp className="w-5 h-5 text-[#309605]" />
                <span className="text-xs font-medium text-[#309605] uppercase tracking-wider">Active Mixes</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats?.total_mixes || 0}</p>
              <p className="text-xs text-gray-600 mt-0.5">Currently Available</p>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span className="text-xs font-medium text-blue-600 uppercase tracking-wider">Users</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats?.active_users || 0}</p>
              <p className="text-xs text-gray-600 mt-0.5">With Daily Mixes</p>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <Calendar className="w-5 h-5 text-green-600" />
                <span className="text-xs font-medium text-green-600 uppercase tracking-wider">Last Update</span>
              </div>
              <p className="text-lg font-bold text-gray-900">
                {stats?.last_generated
                  ? new Date(stats.last_generated).toLocaleDateString()
                  : 'Never'}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {stats?.last_generated
                  ? new Date(stats.last_generated).toLocaleTimeString()
                  : 'No mixes generated yet'}
              </p>
            </div>
          </div>

          {/* Info Card */}
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-[#309605] flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-green-900 mb-1 text-sm">How Daily Mix AI Works</h3>
                <p className="text-sm text-green-800 leading-relaxed mb-2">
                  The Daily Mix AI system analyzes user listening patterns to create personalized playlists.
                  It uses collaborative filtering (similar users), content-based recommendations (genres/moods),
                  and trending analysis to generate multiple themed mixes per user that refresh daily.
                </p>
                <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
                  <li><strong>Collaborative Filtering:</strong> Recommends songs from users with similar tastes</li>
                  <li><strong>Content-Based:</strong> Matches songs to user's favorite genres and moods</li>
                  <li><strong>Trending:</strong> Includes globally popular tracks for discovery</li>
                  <li><strong>Quality Controls:</strong> Filters out low-engagement and spam content</li>
                </ul>
              </div>
            </div>
          </div>

          {/* System Status */}
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#309605]" />
              System Status
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">System Enabled</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${config.enabled ? 'text-green-600' : 'text-gray-500'}`}>
                    {config.enabled ? 'Active' : 'Disabled'}
                  </span>
                  <div className={`w-2 h-2 rounded-full ${config.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Auto Generator</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${config.auto_generate && config.enabled ? 'text-green-600' : 'text-gray-500'}`}>
                    {config.auto_generate && config.enabled ? 'On' : 'Off'}
                  </span>
                  <div className={`w-2 h-2 rounded-full ${config.auto_generate && config.enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Mixes Per User</span>
                <span className="text-sm font-medium text-gray-900">{config.mixes_per_user}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Tracks Per Mix</span>
                <span className="text-sm font-medium text-gray-900">{config.tracks_per_mix}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Familiar/Discovery Ratio</span>
                <span className="text-sm font-medium text-gray-900">
                  {Math.round(config.familiar_ratio * 100)}% / {Math.round((1 - config.familiar_ratio) * 100)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Daily Refresh Time</span>
                <span className="text-sm font-medium text-gray-900">
                  {config.refresh_hour}:00 {config.refresh_hour < 12 ? 'AM' : 'PM'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'config' && (
        <div>
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-blue-900 mb-1 text-sm">System Configuration</h3>
                <p className="text-sm text-blue-800 leading-relaxed">
                  Configure core system settings including the number of mixes, tracks per mix, and content balance.
                  Changes take effect on the next mix generation.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* System Enable/Disable */}
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Enable Daily Mix System</h3>
                  <p className="text-sm text-gray-600">
                    Turn the entire AI playlist generation system on or off
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-[#309605]"></div>
                </label>
              </div>
            </div>

            {/* Auto Generator */}
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Auto Generator</h3>
                  <p className="text-sm text-gray-600">
                    Automatically generate mixes daily at the configured refresh hour
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.auto_generate}
                    onChange={(e) => setConfig({ ...config, auto_generate: e.target.checked })}
                    className="sr-only peer"
                    disabled={!config.enabled}
                  />
                  <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
                </label>
              </div>
              {config.auto_generate && config.enabled && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                  <p className="text-xs text-green-700">
                    Auto generation active &mdash; mixes will refresh daily at <strong>{config.refresh_hour}:00 UTC</strong>
                  </p>
                </div>
              )}
              {!config.enabled && (
                <p className="text-xs text-gray-400 mt-2">Enable the Daily Mix System first to use Auto Generator</p>
              )}
            </div>

            {/* Mix Generation Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Mixes Per User
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={config.mixes_per_user}
                  onChange={(e) => setConfig({ ...config, mixes_per_user: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-[#309605] focus:ring-1 focus:ring-[#309605]"
                />
                <p className="text-xs text-gray-600 mt-2">Number of daily mixes to generate per user (1-10)</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Tracks Per Mix
                </label>
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={config.tracks_per_mix}
                  onChange={(e) => setConfig({ ...config, tracks_per_mix: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-[#309605] focus:ring-1 focus:ring-[#309605]"
                />
                <p className="text-xs text-gray-600 mt-2">Number of tracks in each mix (10-100)</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Familiar Ratio: {Math.round(config.familiar_ratio * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.familiar_ratio}
                  onChange={(e) => setConfig({ ...config, familiar_ratio: parseFloat(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#309605]"
                />
                <div className="flex justify-between text-xs text-gray-600 mt-2">
                  <span>More Discovery</span>
                  <span>More Familiar</span>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Balance between familiar tracks ({Math.round(config.familiar_ratio * 100)}%) and new discoveries ({Math.round((1 - config.familiar_ratio) * 100)}%)
                </p>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Refresh Hour (24h format)
                </label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={config.refresh_hour}
                  onChange={(e) => setConfig({ ...config, refresh_hour: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-[#309605] focus:ring-1 focus:ring-[#309605]"
                />
                <p className="text-xs text-gray-600 mt-2">Hour to automatically refresh mixes (0-23)</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'weights' && (
        <div>
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-blue-900 mb-1 text-sm">Recommendation Algorithm Weights</h3>
                <p className="text-sm text-blue-800 leading-relaxed">
                  Adjust the influence of different recommendation sources. Total weight should equal 100% for optimal balance.
                  Current total: <strong>{Math.round(totalWeight * 100)}%</strong>
                  {!isWeightBalanced && <span className="text-yellow-700"> (Warning: Not balanced at 100%)</span>}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <div className="bg-white border border-blue-200 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-blue-600" />
                <label className="block text-sm font-semibold text-gray-900">
                  Collaborative Filtering: {Math.round(config.collaborative_filtering_weight * 100)}%
                </label>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={config.collaborative_filtering_weight}
                onChange={(e) => setConfig({ ...config, collaborative_filtering_weight: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <p className="text-xs text-gray-600 mt-2">
                Recommends songs from users with similar listening patterns
              </p>
            </div>

            <div className="bg-white border border-green-200 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-2">
                <Award className="w-5 h-5 text-[#309605]" />
                <label className="block text-sm font-semibold text-gray-900">
                  Content-Based: {Math.round(config.content_based_weight * 100)}%
                </label>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={config.content_based_weight}
                onChange={(e) => setConfig({ ...config, content_based_weight: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#309605]"
              />
              <p className="text-xs text-gray-600 mt-2">
                Matches songs to user's favorite genres, moods, and artists
              </p>
            </div>

            <div className="bg-white border border-orange-200 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-orange-600" />
                <label className="block text-sm font-semibold text-gray-900">
                  Trending: {Math.round(config.trending_weight * 100)}%
                </label>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={config.trending_weight}
                onChange={(e) => setConfig({ ...config, trending_weight: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
              />
              <p className="text-xs text-gray-600 mt-2">
                Includes globally trending songs for discovery
              </p>
            </div>

            <div className="bg-white border border-green-200 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-green-600" />
                <label className="block text-sm font-semibold text-gray-900">
                  Diversity Bonus: {Math.round(config.diversity_bonus * 100)}%
                </label>
              </div>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.05"
                value={config.diversity_bonus}
                onChange={(e) => setConfig({ ...config, diversity_bonus: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
              />
              <p className="text-xs text-gray-600 mt-2">
                Bonus score for diverse artist and genre recommendations
              </p>
            </div>
          </div>

          {/* Weight Summary */}
          <div className={`mt-6 p-4 ${isWeightBalanced ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'} border rounded-lg`}>
            <div className="flex items-start gap-3">
              {isWeightBalanced ? (
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <h3 className={`font-semibold ${isWeightBalanced ? 'text-green-900' : 'text-yellow-900'} mb-1 text-sm`}>
                  Weight Balance: {Math.round(totalWeight * 100)}%
                </h3>
                <p className={`text-sm ${isWeightBalanced ? 'text-green-800' : 'text-yellow-800'}`}>
                  {isWeightBalanced
                    ? 'Weights are properly balanced for optimal recommendations.'
                    : 'Consider adjusting weights to total 100% for best results.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'quality' && (
        <div>
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-blue-900 mb-1 text-sm">Quality & Anti-Abuse Controls</h3>
                <p className="text-sm text-blue-800 leading-relaxed">
                  Configure quality thresholds to filter out low-engagement content and prevent spam.
                  These settings help maintain high-quality recommendations.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Min Play Duration (seconds)
              </label>
              <input
                type="number"
                min="10"
                max="120"
                value={config.min_play_duration_seconds}
                onChange={(e) => setConfig({ ...config, min_play_duration_seconds: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-[#309605] focus:ring-1 focus:ring-[#309605]"
              />
              <p className="text-xs text-gray-600 mt-2">
                Minimum duration to count as a valid play (prevents spam)
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Skip Threshold (seconds)
              </label>
              <input
                type="number"
                min="5"
                max="60"
                value={config.skip_threshold_seconds}
                onChange={(e) => setConfig({ ...config, skip_threshold_seconds: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-[#309605] focus:ring-1 focus:ring-[#309605]"
              />
              <p className="text-xs text-gray-600 mt-2">
                Consider as skip if played under this duration
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-6 md:col-span-2">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Quality Threshold: {Math.round(config.quality_threshold * 100)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={config.quality_threshold}
                onChange={(e) => setConfig({ ...config, quality_threshold: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#309605]"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-2">
                <span>More Inclusive (0%)</span>
                <span>More Selective (100%)</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                Minimum recommendation score required to include a track (higher = stricter quality control)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Save Button - Fixed at bottom */}
      {hasUnsavedChanges && (
        <div className="mt-6 pt-6 border-t border-gray-200 flex justify-end">
          <button
            onClick={handleSaveConfig}
            disabled={isSaving}
            className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-medium transition-all flex items-center gap-2 shadow-sm"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Configuration
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
