import React, { useState } from 'react';
import { RefreshCw, Globe, Music, Sparkles, CheckCircle, AlertCircle } from 'lucide-react';
import { refreshGlobalMixesIfNeeded } from '../../lib/globalDailyMixGenerator';

export const GlobalDailyMixManagerSection: React.FC = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const handleGenerateGlobalMixes = async () => {
    try {
      setIsGenerating(true);
      setMessage({ type: 'info', text: 'Generating global daily mixes...' });

      const wasGenerated = await refreshGlobalMixesIfNeeded();

      if (wasGenerated) {
        setMessage({ type: 'success', text: 'Global daily mixes generated successfully!' });
      } else {
        setMessage({ type: 'info', text: 'Global mixes are still fresh, no regeneration needed.' });
      }
    } catch (error) {
      console.error('Error generating global mixes:', error);
      setMessage({ type: 'error', text: 'Failed to generate global mixes. Check console for details.' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleForceRegenerate = async () => {
    try {
      setIsGenerating(true);
      setMessage({ type: 'info', text: 'Force regenerating global daily mixes...' });

      // Import the generator and force regenerate
      const { generateGlobalMixes } = await import('../../lib/globalDailyMixGenerator');
      
      // Force delete old mixes first
      const { supabase } = await import('../../lib/supabase');
      await supabase.from('global_daily_mix_playlists').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      // Generate new ones
      await generateGlobalMixes();

      setMessage({ type: 'success', text: 'Global daily mixes force regenerated successfully!' });
    } catch (error) {
      console.error('Error force regenerating global mixes:', error);
      setMessage({ type: 'error', text: 'Failed to force regenerate global mixes. Check console for details.' });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Globe className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Global Daily Mix Manager</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Manage global daily mixes for non-authenticated and new users
            </p>
          </div>
        </div>
      </div>

      {/* Info Card */}
      <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-[#309605] flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-green-900 mb-1 text-sm">About Global Mixes</h3>
            <p className="text-sm text-green-800 leading-relaxed mb-3">
              Global daily mixes are automatically generated playlists visible to all users (authenticated and non-authenticated).
              They are based on trending songs, popular genres, and global listening patterns.
            </p>
            <ul className="text-sm text-green-800 space-y-1.5">
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>Updated automatically every 24 hours</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>No listening history required</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>Cached for optimal performance</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>Includes artist images and metadata</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={handleGenerateGlobalMixes}
          disabled={isGenerating}
          className="flex items-center justify-center gap-3 p-5 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg text-sm font-medium transition-all flex items-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-5 h-5 ${isGenerating ? 'animate-spin' : ''}`} />
          <div className="text-left">
            <div className="font-semibold">Generate If Needed</div>
            <div className="text-white/80 text-xs">Only generates if mixes are expired</div>
          </div>
        </button>

        <button
          onClick={handleForceRegenerate}
          disabled={isGenerating}
          className="flex items-center justify-center gap-3 p-5 bg-white hover:bg-gray-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Music className={`w-5 h-5 ${isGenerating ? 'animate-pulse' : ''}`} />
          <div className="text-left">
            <div className="font-semibold">Force Regenerate</div>
            <div className="text-gray-500/90 text-xs">Delete old mixes and create new ones</div>
          </div>
        </button>
      </div>

      {/* Status Message */}
      {message && (
        <div className="mb-6">
          <div
            className={`p-4 rounded-r-lg border-l-4 flex items-start gap-3 animate-in slide-in-from-top-2 ${
              message.type === 'success'
                ? 'bg-green-50 border-green-600 text-green-700'
                : message.type === 'error'
                  ? 'bg-red-50 border-red-600 text-red-700'
                  : 'bg-blue-50 border-blue-600 text-blue-700'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            ) : message.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            ) : (
              <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="font-medium text-sm">
                {message.type === 'success' ? 'Success' : message.type === 'error' ? 'Error' : 'Info'}
              </p>
              <p className="text-sm">{message.text}</p>
            </div>
          </div>
        </div>
      )}

      {/* Technical Details */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-600" />
          Technical Details
        </h3>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span className="text-gray-700">Tables:</span>
            <span className="text-gray-900/80 font-mono">global_daily_mix_playlists, global_daily_mix_tracks</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-700">RLS Policies:</span>
            <span className="text-gray-900/80">Public read, Admin write only</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-700">Cache Duration:</span>
            <span className="text-gray-900/80">4 hours (client-side)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-700">Expires After:</span>
            <span className="text-gray-900/80">24 hours (database)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
