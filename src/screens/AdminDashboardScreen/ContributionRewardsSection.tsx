import React, { useState, useEffect } from 'react';
import { Award, TrendingUp, RefreshCw, Save, AlertCircle, CheckCircle, Music, Sparkles, ListMusic, Heart, Target, Zap, Trophy, Users, Info, Edit2, X, Check, Filter, Search, Calendar, Gift } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MonthlyConversionSection } from './MonthlyConversionSection';
import { ContributionScoresSection } from './ContributionScoresSection';

interface ContributionActivity {
  id: string;
  activity_type: string;
  activity_name: string;
  description: string;
  base_reward_points: number;
  is_active: boolean;
  created_at: string;
}

interface ActivityCategory {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  iconColor: string;
  borderColor: string;
  activities: ContributionActivity[];
}

export const ContributionRewardsSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'rewards' | 'conversion' | 'scores'>('rewards');
  const [activities, setActivities] = useState<ContributionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editedActivities, setEditedActivities] = useState<Map<string, Partial<ContributionActivity>>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);

  useEffect(() => {
    loadActivities();
  }, []);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const loadActivities = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('contribution_activities')
        .select('*')
        .order('activity_type');

      if (fetchError) throw fetchError;

      setActivities(data || []);
      setEditedActivities(new Map());
      setEditingId(null);
    } catch (err) {
      console.error('Error loading contribution activities:', err);
      setError('Failed to load contribution activities. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (activity: ContributionActivity, field: string, value: any) => {
    const updated = new Map(editedActivities);
    const current = updated.get(activity.id) || {};
    updated.set(activity.id, { ...current, [field]: value });
    setEditedActivities(updated);
    setError(null);
    setSuccess(null);
  };

  const getValue = (activity: ContributionActivity, field: keyof ContributionActivity) => {
    const edited = editedActivities.get(activity.id);
    return edited?.[field] !== undefined ? edited[field] : activity[field];
  };

  const hasChanges = (activity: ContributionActivity) => {
    return editedActivities.has(activity.id);
  };

  const startEditing = (id: string) => {
    setEditingId(id);
  };

  const cancelEditing = (activity: ContributionActivity) => {
    const updated = new Map(editedActivities);
    updated.delete(activity.id);
    setEditedActivities(updated);
    setEditingId(null);
  };

  const saveActivity = async (activity: ContributionActivity) => {
    const changes = editedActivities.get(activity.id);
    if (!changes) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('You must be logged in to save settings');
      }

      const { error: updateError } = await supabase
        .from('contribution_activities')
        .update(changes)
        .eq('id', activity.id);

      if (updateError) throw updateError;

      setActivities(prev => prev.map(a =>
        a.id === activity.id ? { ...a, ...changes } : a
      ));

      const updated = new Map(editedActivities);
      updated.delete(activity.id);
      setEditedActivities(updated);
      setEditingId(null);

      setSuccess(`"${activity.activity_name}" updated successfully`);
    } catch (err) {
      console.error('Error saving activity:', err);
      setError(err instanceof Error ? err.message : 'Failed to save activity. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async () => {
    if (editedActivities.size === 0) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('You must be logged in to save settings');
      }

      let successCount = 0;
      for (const [id, changes] of editedActivities.entries()) {
        const { error: updateError } = await supabase
          .from('contribution_activities')
          .update(changes)
          .eq('id', id);

        if (updateError) {
          console.error(`Error updating activity ${id}:`, updateError);
          throw new Error(`Failed to update some activities: ${updateError.message}`);
        }
        successCount++;
      }

      await loadActivities();
      setSuccess(`Successfully updated ${successCount} ${successCount === 1 ? 'activity' : 'activities'}`);
    } catch (err) {
      console.error('Error saving all activities:', err);
      setError(err instanceof Error ? err.message : 'Failed to save some changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getCategoryForActivity = (activityType: string): string => {
    if (activityType.includes('playlist')) return 'playlist';
    if (activityType.includes('discovery') || activityType.includes('early_supporter')) return 'discovery';
    if (activityType.includes('listening') || activityType.includes('listener') || activityType.includes('streak') || activityType.includes('daily_active') || activityType.includes('song_completion') || activityType.includes('genre') || activityType.includes('artist_discovery')) return 'listening';
    if (activityType.includes('curation')) return 'curation';
    if (activityType.includes('engagement') || activityType.includes('referral') || activityType.includes('like') || activityType.includes('follow') || activityType.includes('comment') || activityType.includes('share')) return 'engagement';
    return 'other';
  };

  const categoryInfo: Record<string, { icon: any; color: string; bgColor: string; iconColor: string; borderColor: string }> = {
    playlist: {
      icon: ListMusic,
      color: 'blue',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-600',
      borderColor: 'border-blue-200'
    },
    discovery: {
      icon: Sparkles,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-[#309605]',
      borderColor: 'border-green-200'
    },
    listening: {
      icon: Music,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600',
      borderColor: 'border-green-200'
    },
    curation: {
      icon: Target,
      color: 'orange',
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600',
      borderColor: 'border-orange-200'
    },
    engagement: {
      icon: Heart,
      color: 'pink',
      bgColor: 'bg-pink-50',
      iconColor: 'text-pink-600',
      borderColor: 'border-pink-200'
    }
  };

  const groupedActivities: ActivityCategory[] = [
    {
      name: 'Playlist Contributions',
      icon: ListMusic,
      color: 'blue',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-600',
      borderColor: 'border-blue-200',
      activities: activities.filter(a => getCategoryForActivity(a.activity_type) === 'playlist')
    },
    {
      name: 'Discovery & Exploration',
      icon: Sparkles,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-[#309605]',
      borderColor: 'border-green-200',
      activities: activities.filter(a => getCategoryForActivity(a.activity_type) === 'discovery')
    },
    {
      name: 'Listening Engagement',
      icon: Music,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600',
      borderColor: 'border-green-200',
      activities: activities.filter(a => getCategoryForActivity(a.activity_type) === 'listening')
    },
    {
      name: 'Curation',
      icon: Target,
      color: 'orange',
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600',
      borderColor: 'border-orange-200',
      activities: activities.filter(a => getCategoryForActivity(a.activity_type) === 'curation')
    },
    {
      name: 'Community Engagement',
      icon: Heart,
      color: 'pink',
      bgColor: 'bg-pink-50',
      iconColor: 'text-pink-600',
      borderColor: 'border-pink-200',
      activities: activities.filter(a => getCategoryForActivity(a.activity_type) === 'engagement')
    }
  ].filter(cat => cat.activities.length > 0);

  // Filter activities based on search and category
  const filteredActivities = activities.filter(activity => {
    const matchesSearch = searchQuery === '' ||
      activity.activity_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      activity.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      activity.activity_type.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'all' || getCategoryForActivity(activity.activity_type) === selectedCategory;

    const matchesActiveFilter = !showInactiveOnly || !activity.is_active;

    return matchesSearch && matchesCategory && matchesActiveFilter;
  });

  // Calculate stats
  const stats = {
    total: activities.length,
    active: activities.filter(a => a.is_active).length,
    inactive: activities.filter(a => !a.is_active).length,
    avgPoints: activities.length > 0
      ? Math.round(activities.reduce((sum, a) => sum + a.base_reward_points, 0) / activities.length)
      : 0,
    totalPoints: activities.reduce((sum, a) => sum + (a.is_active ? a.base_reward_points : 0), 0)
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
        <p className="ml-3 text-gray-600">Loading contribution activities...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <Gift className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 leading-tight">Contribution System</h2>
              <p className="text-sm text-gray-400 mt-0.5">Configure contribution rewards and monthly conversion settings</p>
            </div>
          </div>

          {activeTab === 'rewards' && (
            <div className="flex items-center gap-2">
              <button
                onClick={loadActivities}
                disabled={loading}
                className="p-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-lg text-gray-700 transition-colors"
                title="Refresh data"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('rewards')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'rewards'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4" />
              Point Rewards
            </div>
          </button>
          <button
            onClick={() => setActiveTab('conversion')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'conversion'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Monthly Conversion
            </div>
          </button>
          <button
            onClick={() => setActiveTab('scores')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'scores'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4" />
              Contribution Scores
            </div>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'conversion' ? (
        <MonthlyConversionSection />
      ) : activeTab === 'scores' ? (
        <ContributionScoresSection />
      ) : (
        <div>
          {/* Point Rewards Content */}

        {/* Stats Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-6 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <Award className="w-5 h-5 text-blue-600" />
              <span className="text-xs font-medium text-blue-600 uppercase tracking-wider">Total</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-600 mt-0.5">Activities</p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-xs font-medium text-green-600 uppercase tracking-wider">Active</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
            <p className="text-xs text-gray-600 mt-0.5">Enabled</p>
          </div>

          <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <X className="w-5 h-5 text-gray-600" />
              <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">Inactive</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.inactive}</p>
            <p className="text-xs text-gray-600 mt-0.5">Disabled</p>
          </div>

          <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <Zap className="w-5 h-5 text-orange-600" />
              <span className="text-xs font-medium text-orange-600 uppercase tracking-wider">Average</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.avgPoints}</p>
            <p className="text-xs text-gray-600 mt-0.5">Points/Activity</p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <Trophy className="w-5 h-5 text-[#309605]" />
              <span className="text-xs font-medium text-[#309605] uppercase tracking-wider">Total</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalPoints}</p>
            <p className="text-xs text-gray-600 mt-0.5">Active Points</p>
          </div>
        </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border-l-4 border-green-600 rounded-r-lg flex items-start gap-3 animate-in slide-in-from-top-2">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-green-900 text-sm">Success</p>
            <p className="text-green-700 text-sm">{success}</p>
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
      {editedActivities.size > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-600 rounded-r-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            <div>
              <p className="font-medium text-yellow-900 text-sm">Unsaved Changes</p>
              <p className="text-yellow-700 text-sm">
                You have {editedActivities.size} unsaved {editedActivities.size === 1 ? 'change' : 'changes'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditedActivities(new Map());
                setEditingId(null);
              }}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium transition-colors"
            >
              Discard All
            </button>
            <button
              onClick={saveAll}
              disabled={saving}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-900 mb-1 text-sm">How Contribution Rewards Work</h3>
            <p className="text-sm text-blue-800 leading-relaxed">
              Listeners earn points through valuable contributions like creating quality playlists, discovering new music,
              and maintaining consistent engagement. Their share of the community reward pool is determined by their total contribution score.
              These rewards are separate from ad revenue and funded by the platform's community budget.
            </p>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search activities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-1 focus:ring-green-600"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-1 focus:ring-green-600"
          >
            <option value="all">All Categories</option>
            <option value="playlist">Playlist</option>
            <option value="discovery">Discovery</option>
            <option value="listening">Listening</option>
            <option value="curation">Curation</option>
            <option value="engagement">Engagement</option>
          </select>

          <button
            onClick={() => setShowInactiveOnly(!showInactiveOnly)}
            className={`px-4 py-2 border rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              showInactiveOnly
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            Inactive Only
          </button>
        </div>
      </div>

      {/* Activities List */}
      <div className="space-y-6">
        {groupedActivities.map((category) => {
          const categoryActivities = category.activities.filter(a =>
            filteredActivities.some(fa => fa.id === a.id)
          );

          if (categoryActivities.length === 0) return null;

          const CategoryIcon = category.icon;

          return (
            <div key={category.name} className="space-y-3">
              {/* Category Header */}
              <div className={`flex items-center gap-3 pb-3 border-b-2 ${category.borderColor}`}>
                <div className={`p-2 ${category.bgColor} rounded-lg`}>
                  <CategoryIcon className={`w-5 h-5 ${category.iconColor}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 text-lg">
                    {category.name}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {categoryActivities.length} {categoryActivities.length === 1 ? 'activity' : 'activities'}
                  </p>
                </div>
              </div>

              {/* Activities */}
              <div className="space-y-3">
                {categoryActivities.map(activity => {
                  const isEditing = editingId === activity.id;
                  const hasUnsavedChanges = hasChanges(activity);
                  const categoryType = getCategoryForActivity(activity.activity_type);
                  const catInfo = categoryInfo[categoryType];

                  return (
                    <div
                      key={activity.id}
                      className={`relative p-4 bg-white border-2 rounded-xl transition-all ${
                        hasUnsavedChanges
                          ? 'border-yellow-400 shadow-md'
                          : isEditing
                          ? `${catInfo.borderColor} shadow-sm`
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {/* Unsaved indicator badge */}
                      {hasUnsavedChanges && !isEditing && (
                        <div className="absolute -top-2 -right-2 px-2 py-1 bg-yellow-500 text-white text-xs font-bold rounded-full shadow-md">
                          UNSAVED
                        </div>
                      )}

                      <div className="flex items-start gap-4">
                        {/* Activity Icon */}
                        <div className={`flex-shrink-0 w-12 h-12 ${catInfo.bgColor} ${catInfo.borderColor} border rounded-lg flex items-center justify-center`}>
                          <catInfo.icon className={`w-6 h-6 ${catInfo.iconColor}`} />
                        </div>

                        {/* Activity Content */}
                        <div className="flex-1 min-w-0">
                          {/* Title and Description */}
                          <div className="mb-3">
                            <h4 className="font-semibold text-gray-900 text-base mb-1 flex items-center gap-2">
                              {activity.activity_name}
                              {!activity.is_active && (
                                <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded-full">
                                  Inactive
                                </span>
                              )}
                            </h4>
                            <p className="text-sm text-gray-600 leading-relaxed">
                              {activity.description}
                            </p>
                            <p className="text-xs text-gray-400 font-mono mt-1">
                              {activity.activity_type}
                            </p>
                          </div>

                          {/* Controls */}
                          {isEditing ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Reward Points
                                  </label>
                                  <input
                                    type="number"
                                    value={getValue(activity, 'base_reward_points') as number}
                                    onChange={(e) => handleEdit(activity, 'base_reward_points', parseInt(e.target.value) || 0)}
                                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
                                    min="0"
                                    placeholder="Enter points"
                                  />
                                </div>

                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Status
                                  </label>
                                  <button
                                    onClick={() => handleEdit(activity, 'is_active', !getValue(activity, 'is_active'))}
                                    className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                      getValue(activity, 'is_active')
                                        ? 'bg-green-600 text-white hover:bg-green-700'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                    }`}
                                  >
                                    {getValue(activity, 'is_active') ? 'Active' : 'Inactive'}
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 pt-2">
                                <button
                                  onClick={() => saveActivity(activity)}
                                  disabled={saving}
                                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                  <Check className="w-4 h-4" />
                                  Save Changes
                                </button>
                                <button
                                  onClick={() => cancelEditing(activity)}
                                  disabled={saving}
                                  className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <Zap className="w-4 h-4 text-orange-500" />
                                <span className="text-2xl font-bold text-gray-900">
                                  {activity.base_reward_points}
                                </span>
                                <span className="text-sm text-gray-500">points</span>
                              </div>

                              <div className="h-6 w-px bg-gray-300"></div>

                              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                                activity.is_active
                                  ? 'bg-green-100 text-green-700 border border-green-200'
                                  : 'bg-gray-100 text-gray-600 border border-gray-200'
                              }`}>
                                {activity.is_active ? 'Active' : 'Inactive'}
                              </div>

                              <div className="flex-1"></div>

                              <button
                                onClick={() => startEditing(activity.id)}
                                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium transition-colors flex items-center gap-2"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {filteredActivities.length === 0 && (
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <Search className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No activities found</p>
            <p className="text-sm text-gray-500 mt-1">
              Try adjusting your search or filter criteria
            </p>
          </div>
        )}
      </div>

      {/* Guidelines Section */}
      <div className="mt-8 p-5 bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <Trophy className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-base">
              Reward Configuration Guidelines
            </h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Follow these best practices for balanced reward distribution
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600"></div>
              Daily Activities
            </h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Keep between <strong className="text-gray-900">10-25 points</strong> to encourage consistent daily engagement without overwhelming the system.
            </p>
          </div>

          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-600"></div>
              Listening Milestones
            </h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Progressive rewards <strong className="text-gray-900">(5→10, 10→15, 20→25)</strong> for daily listening. Each milestone is independent and stackable.
            </p>
          </div>

          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#309605]"></div>
              Weekly Milestones
            </h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Set at <strong className="text-gray-900">20-50 points</strong> for meaningful weekly achievements that recognize sustained effort.
            </p>
          </div>

          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-600"></div>
              Streak Rewards
            </h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Scale significantly <strong className="text-gray-900">(30 → 75 → 300)</strong> for 3/7/30 day streaks to reward loyalty and consistency.
            </p>
          </div>

          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-orange-600"></div>
              Quality Bonuses
            </h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Reward exceptional contributions with <strong className="text-gray-900">50-200 points</strong> for high-impact activities like viral playlists.
            </p>
          </div>
        </div>

        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800 leading-relaxed">
            <strong className="text-yellow-900">Tip:</strong> Temporarily disable activities when adjusting the reward structure to prevent inconsistencies. Re-enable once you've finalized the new point values.
          </p>
        </div>
      </div>
        </div>
      )}
    </div>
  );
};
