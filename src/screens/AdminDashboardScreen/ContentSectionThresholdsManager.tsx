import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Edit2, Save, X, Info } from 'lucide-react';

interface SectionThreshold {
  id: string;
  section_key: string;
  section_name: string;
  section_description: string;
  min_play_count: number;
  min_like_count: number;
  time_window_days: number | null;
  is_enabled: boolean;
  notes: string;
  updated_at: string;
}

export function ContentSectionThresholdsManager() {
  const [thresholds, setThresholds] = useState<SectionThreshold[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SectionThreshold>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadThresholds();
  }, []);

  const loadThresholds = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('content_section_thresholds')
        .select('*')
        .order('section_name');

      if (error) throw error;
      setThresholds(data || []);
    } catch (error: any) {
      console.error('Error loading thresholds:', error);
      showMessage('error', 'Failed to load thresholds');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (threshold: SectionThreshold) => {
    setEditingId(threshold.id);
    setEditForm({
      min_play_count: threshold.min_play_count,
      min_like_count: threshold.min_like_count,
      time_window_days: threshold.time_window_days,
      is_enabled: threshold.is_enabled,
      notes: threshold.notes,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveThreshold = async (sectionKey: string) => {
    try {
      setSaving(true);

      const { data, error } = await supabase.rpc('admin_update_section_threshold', {
        section_key_param: sectionKey,
        min_play_count_param: editForm.min_play_count,
        min_like_count_param: editForm.min_like_count,
        time_window_days_param: editForm.time_window_days,
        is_enabled_param: editForm.is_enabled,
        notes_param: editForm.notes,
      });

      if (error) throw error;

      showMessage('success', `Updated ${data.section_name} threshold successfully`);
      await loadThresholds();
      cancelEdit();
    } catch (error: any) {
      console.error('Error saving threshold:', error);
      showMessage('error', error.message || 'Failed to save threshold');
    } finally {
      setSaving(false);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const getSectionIcon = (sectionKey: string) => {
    const icons: Record<string, string> = {
      featured_artists: '⭐',
      global_trending: '🔥',
      trending_near_you: '📍',
      blowing_up: '🚀',
      tracks_blowing_up: '🚀',
      new_releases: '🆕',
      trending_albums: '💿',
    };
    return icons[sectionKey] || '📊';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#309605]"></div>
          <span className="ml-3 text-gray-600">Loading section thresholds...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Edit2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 leading-tight">Content Section Thresholds</h2>
              <p className="text-sm text-gray-400 mt-0.5">Control play count requirements for each content section independently</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Info className="w-3.5 h-3.5" />
            <span>Changes apply immediately</span>
          </div>
        </div>

        {message && (
          <div
            className={`mb-4 p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          {thresholds.map((threshold) => {
            const isEditing = editingId === threshold.id;

            return (
              <div
                key={threshold.id}
                className={`border rounded-lg p-4 transition-all ${
                  isEditing ? 'border-[#309605] bg-[#e6f7f1]' : 'border-gray-200 bg-white'
                } ${!threshold.is_enabled ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{getSectionIcon(threshold.section_key)}</span>
                    <div>
                      <h3 className="font-semibold text-gray-900">{threshold.section_name}</h3>
                      <p className="text-sm text-gray-600">{threshold.section_description}</p>
                      {threshold.section_key === 'featured_artists' && (
                        <p className="text-xs text-amber-800 mt-1 max-w-xl">
                          <strong>Auto-Select Eligible Artistes</strong> uses these min plays/likes and time window
                          (docs/sql/update_featured_artists_weekly.sql). Manual Featured Artistes always show on home
                          when active. Enable section hides the whole rail.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isEditing ? (
                      <button
                        onClick={() => startEdit(threshold)}
                        className="p-2 text-gray-600 hover:text-[#309605] hover:bg-gray-100 rounded transition-colors"
                        title="Edit threshold"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => saveThreshold(threshold.section_key)}
                          disabled={saving}
                          className="px-3 py-2 bg-[#309605] text-white rounded hover:bg-[#3ba208] disabled:opacity-50 flex items-center gap-2"
                        >
                          <Save className="w-4 h-4" />
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="p-2 text-gray-600 hover:text-red-600 hover:bg-gray-100 rounded transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  {/* Min Play Count */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Min Play Count
                    </label>
                    {isEditing ? (
                      <input
                        type="number"
                        min="0"
                        value={editForm.min_play_count ?? 0}
                        onChange={(e) =>
                          setEditForm({ ...editForm, min_play_count: parseInt(e.target.value) || 0 })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                      />
                    ) : (
                      <div className="text-2xl font-bold text-[#309605]">
                        {threshold.min_play_count.toLocaleString()}
                      </div>
                    )}
                  </div>

                  {/* Min Like Count */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Min Like Count
                    </label>
                    {isEditing ? (
                      <input
                        type="number"
                        min="0"
                        value={editForm.min_like_count ?? 0}
                        onChange={(e) =>
                          setEditForm({ ...editForm, min_like_count: parseInt(e.target.value) || 0 })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                      />
                    ) : (
                      <div className="text-2xl font-bold text-[#309605]">
                        {threshold.min_like_count.toLocaleString()}
                      </div>
                    )}
                  </div>

                  {/* Time Window */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Time Window (Days)
                    </label>
                    {isEditing ? (
                      <input
                        type="number"
                        min="1"
                        placeholder="All time"
                        value={editForm.time_window_days ?? ''}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            time_window_days: e.target.value ? parseInt(e.target.value) : null,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                      />
                    ) : (
                      <div className="text-2xl font-bold text-[#309605]">
                        {threshold.time_window_days ?? 'All Time'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Status and Notes */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {isEditing ? (
                        <div className="space-y-3">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={editForm.is_enabled ?? true}
                              onChange={(e) =>
                                setEditForm({ ...editForm, is_enabled: e.target.checked })
                              }
                              className="rounded text-[#309605] focus:ring-[#309605]"
                            />
                            <span className="text-sm font-medium text-gray-700">Enable section</span>
                          </label>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Notes
                            </label>
                            <textarea
                              value={editForm.notes ?? ''}
                              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                              rows={2}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                              placeholder="Admin notes about this threshold..."
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              threshold.is_enabled
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {threshold.is_enabled ? '✓ Enabled' : '✗ Disabled'}
                          </span>
                          {threshold.notes && (
                            <p className="text-gray-600 mt-2">{threshold.notes}</p>
                          )}
                          <p className="text-xs text-gray-500 mt-2">
                            Last updated: {new Date(threshold.updated_at).toLocaleString()}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
            <p className="text-xs font-semibold text-blue-900 mb-1.5">How it works</p>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• Each section has independent play count and like count thresholds</li>
              <li>• Content must meet both requirements to appear in a section</li>
              <li>• Time window filters content based on recent activity (null = all time)</li>
              <li>• Disabling a section removes it from the app entirely</li>
            </ul>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <p className="text-xs font-semibold text-amber-900 mb-1.5">Cache Notice</p>
            <p className="text-xs text-amber-800">
              Home screen data is cached for 5 minutes. After changing thresholds, wait up to 5 minutes to see changes on the home screen. "View All" screens update immediately.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
