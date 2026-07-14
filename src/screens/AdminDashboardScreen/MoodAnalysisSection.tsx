import { useState, useEffect } from 'react';
import { Sparkles, TrendingUp, Music2, RefreshCw, BarChart3 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { analyzeSongMood, batchAnalyzeSongs } from '../../lib/moodAnalysisService';

interface MoodCategory {
  name: string;
  type: string;
  total_listens: number;
  users: number;
}

interface SongAnalysisStats {
  total_songs: number;
  analyzed_songs: number;
  coverage_percent: number;
}

export const MoodAnalysisSection = (): JSX.Element => {
  const [stats, setStats] = useState<SongAnalysisStats | null>(null);
  const [topMoods, setTopMoods] = useState<MoodCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  useEffect(() => {
    loadMoodStats();
  }, []);

  const loadMoodStats = async () => {
    setIsLoading(true);

    try {
      // Get analysis coverage
      const { data: coverageData, error: coverageError } = await supabase
        .rpc('get_mood_analysis_coverage') as any;

      if (coverageError) {
        // Fallback query if function doesn't exist
        const { data: songs } = await supabase
          .from('songs')
          .select('id')
          .eq('published', true);

        const { data: analyzed } = await supabase
          .from('song_mood_analysis')
          .select('song_id');

        if (songs && analyzed) {
          setStats({
            total_songs: songs.length,
            analyzed_songs: analyzed.length,
            coverage_percent: songs.length > 0 ? (analyzed.length / songs.length) * 100 : 0,
          });
        }
      } else if (coverageData && coverageData.length > 0) {
        setStats(coverageData[0]);
      }

      // Get top moods by engagement
      const { data: moodsData, error: moodsError } = await supabase
        .rpc('get_top_moods_by_engagement') as any;

      if (moodsError) {
        // Fallback query
        const { data: moods } = await supabase
          .from('mood_categories')
          .select(`
            name,
            type,
            user_mood_preferences (
              user_id,
              listen_count
            )
          `);

        if (moods) {
          const aggregated = moods.map((mood: any) => ({
            name: mood.name,
            type: mood.type,
            users: new Set(mood.user_mood_preferences.map((p: any) => p.user_id)).size,
            total_listens: mood.user_mood_preferences.reduce(
              (sum: number, p: any) => sum + p.listen_count,
              0
            ),
          })).sort((a, b) => b.total_listens - a.total_listens).slice(0, 10);

          setTopMoods(aggregated);
        }
      } else {
        setTopMoods(moodsData || []);
      }
    } catch (error) {
      console.error('Error loading mood stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeUnanalyzedSongs = async () => {
    setIsAnalyzing(true);
    setAnalysisProgress(0);

    try {
      // Get songs without mood analysis
      const { data: unanalyzedSongs, error } = await supabase
        .from('songs')
        .select('id')
        .eq('published', true)
        .not('id', 'in',
          supabase.from('song_mood_analysis').select('song_id')
        )
        .limit(100); // Process 100 at a time

      if (error) throw error;

      if (!unanalyzedSongs || unanalyzedSongs.length === 0) {
        alert('All published songs have been analyzed!');
        return;
      }

      const songIds = unanalyzedSongs.map((s) => s.id);
      const totalSongs = songIds.length;

      // Analyze in batches of 10
      for (let i = 0; i < songIds.length; i += 10) {
        const batch = songIds.slice(i, i + 10);
        await batchAnalyzeSongs(batch);
        setAnalysisProgress(Math.round(((i + batch.length) / totalSongs) * 100));
      }

      alert(`Successfully analyzed ${totalSongs} songs!`);
      loadMoodStats();
    } catch (error) {
      console.error('Error analyzing songs:', error);
      alert('Error analyzing songs. See console for details.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  const reanalyzeAllSongs = async () => {
    if (!confirm('This will re-analyze ALL published songs. This may take several minutes. Continue?')) {
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);

    try {
      const { data: songs, error } = await supabase
        .from('songs')
        .select('id')
        .eq('published', true);

      if (error) throw error;

      if (!songs || songs.length === 0) {
        alert('No published songs found.');
        return;
      }

      const songIds = songs.map((s) => s.id);
      const totalSongs = songIds.length;

      // Analyze in batches of 10
      for (let i = 0; i < songIds.length; i += 10) {
        const batch = songIds.slice(i, i + 10);
        await batchAnalyzeSongs(batch);
        setAnalysisProgress(Math.round(((i + batch.length) / totalSongs) * 100));
      }

      alert(`Successfully re-analyzed ${totalSongs} songs!`);
      loadMoodStats();
    } catch (error) {
      console.error('Error re-analyzing songs:', error);
      alert('Error re-analyzing songs. See console for details.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-100 rounded w-1/3" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-100 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-[#309605]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 leading-tight">Mood Analysis</h2>
              <p className="text-sm text-gray-400 mt-0.5">AI-driven mood categorization for songs</p>
            </div>
          </div>
          <button onClick={loadMoodStats} disabled={isAnalyzing}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 text-gray-500 ${isAnalyzing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Total Songs', value: stats.total_songs.toLocaleString(), icon: <Music2 className="w-3.5 h-3.5 text-blue-600" />, bg: 'bg-blue-50' },
              { label: 'Analyzed', value: stats.analyzed_songs.toLocaleString(), icon: <Sparkles className="w-3.5 h-3.5 text-[#309605]" />, bg: 'bg-green-50' },
              { label: 'Coverage', value: `${stats.coverage_percent.toFixed(1)}%`, icon: <TrendingUp className="w-3.5 h-3.5 text-[#309605]" />, bg: 'bg-green-50' },
            ].map((stat) => (
              <div key={stat.label} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className={`w-5 h-5 rounded ${stat.bg} flex items-center justify-center`}>{stat.icon}</div>
                  <p className="text-xs text-gray-500">{stat.label}</p>
                </div>
                <p className="text-lg font-bold text-gray-900">{stat.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <button onClick={analyzeUnanalyzedSongs} disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {isAnalyzing ? `Analyzing... ${analysisProgress}%` : 'Analyze Unanalyzed Songs'}
          </button>
          <button onClick={reanalyzeAllSongs} disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200">
            Re-analyze All Songs
          </button>
        </div>
      </div>

      {/* Top Moods */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-gray-500" />
          <p className="text-sm font-semibold text-gray-900">Most Popular Moods</p>
        </div>

        <div className="space-y-2">
          {topMoods.length > 0 ? (
            topMoods.map((mood, index) => (
              <div key={mood.name} className="p-3 bg-gray-50 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-bold text-gray-300">#{index + 1}</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{mood.name}</p>
                      <p className="text-xs text-gray-400">{mood.type === 'mood' ? 'Mood' : 'Activity'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">{mood.total_listens.toLocaleString()}</p>
                    <p className="text-xs text-gray-400">{mood.users} users</p>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className="bg-[#309605] h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (mood.total_listens / (topMoods[0]?.total_listens || 1)) * 100)}%` }} />
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 text-center">
              <p className="text-sm text-gray-400">No mood data available yet. Start by analyzing some songs!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
