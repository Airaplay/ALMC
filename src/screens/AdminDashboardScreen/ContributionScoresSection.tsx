import { useState, useEffect } from 'react';
import { Trophy, TrendingUp, Plus, Minus, Search, History, Award, AlertCircle, CheckCircle, RefreshCw, Info, Users, Zap, X, BarChart } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ContributionScore {
  user_id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  role: string;
  total_points: number;
  current_period_points: number;
  playlist_creation_points: number;
  discovery_points: number;
  curation_points: number;
  engagement_points: number;
  last_reward_date: string | null;
  updated_at: string;
  total_contributions: number;
}

interface Adjustment {
  id: string;
  user_id: string;
  username: string;
  admin_id: string;
  admin_username: string;
  points_change: number;
  category: string;
  reason: string;
  previous_value: number;
  new_value: number;
  created_at: string;
}

export const ContributionScoresSection = () => {
  const [scores, setScores] = useState<ContributionScore[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'current_period_points' | 'total_points' | 'username'>('current_period_points');
  const [selectedUser, setSelectedUser] = useState<ContributionScore | null>(null);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'subtract'>('add');
  const [pointsAmount, setPointsAmount] = useState('');
  const [category, setCategory] = useState<string>('current_period_points');
  const [reason, setReason] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadContributionScores();
    loadAdjustmentHistory();
  }, [searchTerm, sortBy]);

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

  const loadContributionScores = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase.rpc('admin_get_all_contribution_scores', {
        p_search: searchTerm || null,
        p_sort_by: sortBy,
        p_limit: 100,
        p_offset: 0
      });

      if (fetchError) throw fetchError;
      setScores(data || []);
    } catch (err: any) {
      console.error('Error loading contribution scores:', err);
      setError(err.message || 'Failed to load contribution scores. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAdjustmentHistory = async () => {
    try {
      const { data, error: fetchError } = await supabase.rpc('admin_get_contribution_adjustments', {
        p_user_id: null,
        p_limit: 50
      });

      if (fetchError) throw fetchError;
      setAdjustments(data || []);
    } catch (err) {
      console.error('Error loading adjustment history:', err);
    }
  };

  const handleAdjustScore = async () => {
    if (!selectedUser || !pointsAmount || !reason.trim()) {
      setError('Please fill in all fields');
      return;
    }

    const points = parseInt(pointsAmount);
    if (isNaN(points) || points <= 0) {
      setError('Please enter a valid positive number');
      return;
    }

    try {
      setIsAdjusting(true);
      setError(null);
      const pointsChange = adjustmentType === 'add' ? points : -points;

      const { data, error: adjustError } = await supabase.rpc('admin_adjust_contribution_score', {
        p_user_id: selectedUser.user_id,
        p_points_change: pointsChange,
        p_category: category,
        p_reason: reason
      });

      if (adjustError) throw adjustError;

      setSuccess(
        `Successfully ${adjustmentType === 'add' ? 'added' : 'subtracted'} ${points} points ${adjustmentType === 'add' ? 'to' : 'from'} ${selectedUser.username || selectedUser.display_name || selectedUser.email?.split('@')[0] || 'user'}`
      );

      await loadContributionScores();
      await loadAdjustmentHistory();

      setShowAdjustModal(false);
      setSelectedUser(null);
      setPointsAmount('');
      setReason('');
      setCategory('current_period_points');
      setAdjustmentType('add');
    } catch (err: any) {
      console.error('Error adjusting contribution score:', err);
      setError(err.message || 'Failed to adjust contribution score');
    } finally {
      setIsAdjusting(false);
    }
  };

  const getCategoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      total_points: 'Total Points',
      current_period_points: 'Current Period Points',
      playlist_creation_points: 'Playlist Points',
      discovery_points: 'Discovery Points',
      curation_points: 'Curation Points',
      engagement_points: 'Engagement Points'
    };
    return labels[cat] || cat;
  };

  const stats = {
    totalCurrentPoints: scores.reduce((sum, s) => sum + s.current_period_points, 0),
    activeContributors: scores.length,
    totalContributions: scores.reduce((sum, s) => sum + s.total_contributions, 0),
    avgPointsPerUser: scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s.current_period_points, 0) / scores.length) : 0
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
        <p className="ml-3 text-gray-600">Loading contribution scores...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <BarChart className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Contribution Scores</h2>
            <p className="text-sm text-gray-400 mt-0.5">Monitor and manage user contribution scores</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistoryModal(true)}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium transition-colors flex items-center gap-2"
          >
            <History className="w-4 h-4" />
            History
          </button>
          <button
            onClick={loadContributionScores}
            disabled={isLoading}
            className="p-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-lg text-gray-700 transition-colors"
            title="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
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

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <Zap className="w-5 h-5 text-[#309605]" />
            <span className="text-xs font-medium text-[#309605] uppercase tracking-wider">Points</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.totalCurrentPoints.toLocaleString()}</p>
          <p className="text-xs text-gray-600 mt-0.5">Current Period</p>
        </div>

        <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <Users className="w-5 h-5 text-blue-600" />
            <span className="text-xs font-medium text-blue-600 uppercase tracking-wider">Users</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.activeContributors}</p>
          <p className="text-xs text-gray-600 mt-0.5">Active Contributors</p>
        </div>

        <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <Trophy className="w-5 h-5 text-green-600" />
            <span className="text-xs font-medium text-green-600 uppercase tracking-wider">Activity</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.totalContributions.toLocaleString()}</p>
          <p className="text-xs text-gray-600 mt-0.5">Total Contributions</p>
        </div>

        <div className="p-4 bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-5 h-5 text-orange-600" />
            <span className="text-xs font-medium text-orange-600 uppercase tracking-wider">Average</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.avgPointsPerUser}</p>
          <p className="text-xs text-gray-600 mt-0.5">Points/User</p>
        </div>
      </div>

      {/* Info Card */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-900 mb-1 text-sm">Managing Contribution Scores</h3>
            <p className="text-sm text-blue-800 leading-relaxed">
              Use the add/subtract buttons to manually adjust user scores when needed. All adjustments are logged with reasons for audit purposes. Current period points reset monthly during conversion, while total points track all-time contributions.
            </p>
          </div>
        </div>
      </div>

      {/* Search and Sort */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by username or email..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
        >
          <option value="current_period_points">Sort by Current Period</option>
          <option value="total_points">Sort by Total Points</option>
          <option value="username">Sort by Username</option>
        </select>
      </div>

      {/* Scores Table */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Current Period</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Total Points</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Playlist</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Discovery</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Curation</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Engagement</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {scores.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <Award className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">No contribution scores yet</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Users will appear here once they start earning contribution points
                    </p>
                  </td>
                </tr>
              ) : (
                scores.map((score) => (
                  <tr key={score.user_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {score.avatar_url ? (
                          <img src={score.avatar_url} alt={score.username} className="w-10 h-10 rounded-full" />
                        ) : (
                          <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center">
                            <span className="text-white font-medium text-sm">
                              {(score.username?.[0] || score.display_name?.[0] || score.email?.[0] || 'U').toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="text-gray-900 font-medium">
                            {score.username || score.display_name || score.email?.split('@')[0] || 'Unknown User'}
                          </p>
                          <p className="text-xs text-gray-500">{score.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700 border border-green-200">
                        {score.current_period_points.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-gray-900 font-medium">{score.total_points.toLocaleString()}</span>
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">{score.playlist_creation_points.toLocaleString()}</td>
                    <td className="px-6 py-4 text-center text-gray-700">{score.discovery_points.toLocaleString()}</td>
                    <td className="px-6 py-4 text-center text-gray-700">{score.curation_points.toLocaleString()}</td>
                    <td className="px-6 py-4 text-center text-gray-700">{score.engagement_points.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedUser(score);
                            setAdjustmentType('add');
                            setShowAdjustModal(true);
                          }}
                          className="p-2 bg-green-100 hover:bg-green-200 border border-green-300 rounded-lg text-green-700 transition-colors"
                          title="Add Points"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUser(score);
                            setAdjustmentType('subtract');
                            setShowAdjustModal(true);
                          }}
                          className="p-2 bg-red-100 hover:bg-red-200 border border-red-300 rounded-lg text-red-700 transition-colors"
                          title="Subtract Points"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjust Score Modal */}
      {showAdjustModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                {adjustmentType === 'add' ? 'Add' : 'Subtract'} Points
              </h3>
              <button
                onClick={() => {
                  setShowAdjustModal(false);
                  setSelectedUser(null);
                  setPointsAmount('');
                  setReason('');
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">User</label>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  {selectedUser.avatar_url ? (
                    <img src={selectedUser.avatar_url} alt={selectedUser.username || selectedUser.display_name} className="w-10 h-10 rounded-full" />
                  ) : (
                    <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center">
                      <span className="text-white font-medium">
                        {(selectedUser.username?.[0] || selectedUser.display_name?.[0] || selectedUser.email?.[0] || 'U').toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div>
                    <p className="text-gray-900 font-medium">
                      {selectedUser.username || selectedUser.display_name || selectedUser.email?.split('@')[0] || 'Unknown User'}
                    </p>
                    <p className="text-xs text-gray-500">{selectedUser.email}</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
                >
                  <option value="current_period_points">Current Period Points</option>
                  <option value="total_points">Total Points</option>
                  <option value="playlist_creation_points">Playlist Points</option>
                  <option value="discovery_points">Discovery Points</option>
                  <option value="curation_points">Curation Points</option>
                  <option value="engagement_points">Engagement Points</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Points Amount</label>
                <input
                  type="number"
                  value={pointsAmount}
                  onChange={(e) => setPointsAmount(e.target.value)}
                  min="1"
                  placeholder="Enter points amount"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why you're adjusting the score..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600 focus:ring-opacity-20 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowAdjustModal(false);
                    setSelectedUser(null);
                    setPointsAmount('');
                    setReason('');
                  }}
                  className="flex-1 px-4 py-2.5 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-gray-700 font-medium transition-colors"
                  disabled={isAdjusting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdjustScore}
                  disabled={isAdjusting || !pointsAmount || !reason.trim()}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-white font-medium transition-colors ${
                    adjustmentType === 'add'
                      ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-600/50'
                      : 'bg-red-600 hover:bg-red-700 disabled:bg-red-600/50'
                  } disabled:cursor-not-allowed`}
                >
                  {isAdjusting ? 'Adjusting...' : adjustmentType === 'add' ? 'Add Points' : 'Subtract Points'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Adjustment History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Adjustment History</h3>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-3">
                {adjustments.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">No adjustments yet</p>
                    <p className="text-sm text-gray-500 mt-1">Adjustment history will appear here</p>
                  </div>
                ) : (
                  adjustments.map((adj) => (
                    <div key={adj.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-gray-900 font-medium">{adj.username}</span>
                            <span className="text-gray-400">•</span>
                            <span className={`font-medium ${adj.points_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {adj.points_change > 0 ? '+' : ''}{adj.points_change} points
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mb-2">
                            {getCategoryLabel(adj.category)}: {adj.previous_value} → {adj.new_value}
                          </p>
                          <p className="text-sm text-gray-700">{adj.reason}</p>
                          <p className="text-xs text-gray-500 mt-2">
                            By {adj.admin_username} • {new Date(adj.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
