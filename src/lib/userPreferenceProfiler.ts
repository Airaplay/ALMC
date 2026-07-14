/**
 * User Preference Profiler Service
 *
 * Analyzes user listening behavior to build comprehensive preference profiles
 * Used for generating personalized daily mix playlists
 *
 * Key Features:
 * - Genre and mood preferences
 * - Top artists
 * - Listening time patterns
 * - Skip/completion rates
 * - Diversity score
 */

import { supabase } from './supabase';

export interface GenrePreference {
  genre_id: string;
  genre_name: string;
  score: number;
  play_count: number;
}

export interface MoodPreference {
  mood_id: string;
  mood_name: string;
  score: number;
  play_count: number;
}

export interface ArtistPreference {
  artist_id: string;
  artist_name: string;
  score: number;
  play_count: number;
}

export interface ListeningTimePattern {
  hour: number;
  play_count: number;
  avg_completion_rate: number;
}

export interface UserProfile {
  user_id: string;
  top_genres: GenrePreference[];
  top_moods: MoodPreference[];
  top_artists: ArtistPreference[];
  listening_time_patterns: { [key: number]: ListeningTimePattern };
  avg_session_duration: number;
  skip_rate: number;
  completion_rate: number;
  diversity_score: number;
}

/**
 * Get user's listening statistics with quality filters
 */
async function getUserListeningStats(userId: string, minDurationSeconds: number = 30) {
  // Get valid playback history (anti-abuse filters)
  const { data: playbacks, error } = await supabase
    .from('playback_history')
    .select(`
      id,
      song_id,
      listened_at,
      duration_seconds,
      completed,
      songs (
        id,
        title,
        artist_id,
        play_count
      )
    `)
    .eq('user_id', userId)
    .gte('duration_seconds', minDurationSeconds)
    .gte('listened_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()) // Last 90 days
    .order('listened_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return playbacks || [];
}

/**
 * Calculate genre preferences from listening history
 */
async function calculateGenrePreferences(userId: string, playbacks: any[]): Promise<GenrePreference[]> {
  const songIds = playbacks.map(p => p.song_id);

  if (songIds.length === 0) return [];

  // Get genre associations for played songs
  const { data: genreData, error } = await supabase
    .from('song_genres')
    .select(`
      song_id,
      genres (
        id,
        name
      )
    `)
    .in('song_id', songIds);

  if (error || !genreData) return [];

  // Calculate genre scores based on play frequency
  const genreCounts: { [key: string]: { count: number; name: string } } = {};

  genreData.forEach((sg: any) => {
    if (sg.genres) {
      const genreId = sg.genres.id;
      if (!genreCounts[genreId]) {
        genreCounts[genreId] = { count: 0, name: sg.genres.name };
      }
      genreCounts[genreId].count++;
    }
  });

  const totalPlays = playbacks.length;

  // Convert to preferences array with normalized scores
  const preferences = Object.entries(genreCounts).map(([genreId, data]) => ({
    genre_id: genreId,
    genre_name: data.name,
    score: data.count / totalPlays,
    play_count: data.count
  }));

  // Sort by score and return top 10
  return preferences.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Calculate mood preferences from listening history
 */
async function calculateMoodPreferences(userId: string, playbacks: any[]): Promise<MoodPreference[]> {
  const songIds = playbacks.map(p => p.song_id);

  if (songIds.length === 0) return [];

  // Get mood associations for played songs
  const { data: moodData, error } = await supabase
    .from('song_moods')
    .select(`
      song_id,
      confidence_score,
      moods (
        id,
        name
      )
    `)
    .in('song_id', songIds)
    .gte('confidence_score', 0.5);

  if (error || !moodData) return [];

  // Calculate mood scores weighted by confidence
  const moodCounts: { [key: string]: { count: number; name: string; totalConfidence: number } } = {};

  moodData.forEach((sm: any) => {
    if (sm.moods) {
      const moodId = sm.moods.id;
      if (!moodCounts[moodId]) {
        moodCounts[moodId] = { count: 0, name: sm.moods.name, totalConfidence: 0 };
      }
      moodCounts[moodId].count++;
      moodCounts[moodId].totalConfidence += parseFloat(sm.confidence_score);
    }
  });

  const totalPlays = playbacks.length;

  // Convert to preferences array with normalized scores
  const preferences = Object.entries(moodCounts).map(([moodId, data]) => ({
    mood_id: moodId,
    mood_name: data.name,
    score: (data.count / totalPlays) * (data.totalConfidence / data.count), // Weighted by confidence
    play_count: data.count
  }));

  // Sort by score and return top 10
  return preferences.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Calculate top artist preferences
 */
async function calculateArtistPreferences(userId: string, playbacks: any[]): Promise<ArtistPreference[]> {
  const artistCounts: { [key: string]: number } = {};

  playbacks.forEach(p => {
    if (p.songs && p.songs.artist_id) {
      const artistId = p.songs.artist_id;
      artistCounts[artistId] = (artistCounts[artistId] || 0) + 1;
    }
  });

  const artistIds = Object.keys(artistCounts);
  if (artistIds.length === 0) return [];

  // Get artist names
  const { data: artists, error } = await supabase
    .from('users')
    .select('id, display_name')
    .in('id', artistIds);

  if (error || !artists) return [];

  const totalPlays = playbacks.length;

  const preferences = artists.map(artist => ({
    artist_id: artist.id,
    artist_name: artist.display_name,
    score: artistCounts[artist.id] / totalPlays,
    play_count: artistCounts[artist.id]
  }));

  // Sort by score and return top 20
  return preferences.sort((a, b) => b.score - a.score).slice(0, 20);
}

/**
 * Calculate listening time patterns (hour of day analysis)
 */
function calculateListeningTimePatterns(playbacks: any[]): { [key: number]: ListeningTimePattern } {
  const hourPatterns: { [key: number]: { plays: number; completions: number } } = {};

  // Initialize all hours
  for (let hour = 0; hour < 24; hour++) {
    hourPatterns[hour] = { plays: 0, completions: 0 };
  }

  playbacks.forEach(p => {
    const hour = new Date(p.listened_at).getHours();
    hourPatterns[hour].plays++;
    if (p.completed) {
      hourPatterns[hour].completions++;
    }
  });

  const patterns: { [key: number]: ListeningTimePattern } = {};

  Object.entries(hourPatterns).forEach(([hourStr, data]) => {
    const hour = parseInt(hourStr);
    patterns[hour] = {
      hour,
      play_count: data.plays,
      avg_completion_rate: data.plays > 0 ? data.completions / data.plays : 0
    };
  });

  return patterns;
}

/**
 * Calculate skip rate (percentage of tracks skipped)
 */
function calculateSkipRate(playbacks: any[], skipThresholdSeconds: number = 15): number {
  if (playbacks.length === 0) return 0;

  const skips = playbacks.filter(p => p.duration_seconds < skipThresholdSeconds).length;
  return skips / playbacks.length;
}

/**
 * Calculate completion rate (percentage of tracks fully listened)
 */
function calculateCompletionRate(playbacks: any[]): number {
  if (playbacks.length === 0) return 0;

  const completions = playbacks.filter(p => p.completed).length;
  return completions / playbacks.length;
}

/**
 * Calculate diversity score (how varied the user's taste is)
 * Higher score = more diverse taste
 */
function calculateDiversityScore(
  genrePrefs: GenrePreference[],
  artistPrefs: ArtistPreference[]
): number {
  // Calculate genre diversity (Shannon entropy)
  let genreEntropy = 0;
  genrePrefs.forEach(g => {
    if (g.score > 0) {
      genreEntropy -= g.score * Math.log2(g.score);
    }
  });

  // Calculate artist diversity (Herfindahl-Hirschman Index)
  const artistHHI = artistPrefs.reduce((sum, a) => sum + (a.score * a.score), 0);
  const artistDiversity = 1 - artistHHI;

  // Normalize and combine (0-1 scale)
  const maxGenreEntropy = Math.log2(Math.min(genrePrefs.length, 10));
  const normalizedGenreDiv = maxGenreEntropy > 0 ? genreEntropy / maxGenreEntropy : 0;

  // Weighted average
  return (normalizedGenreDiv * 0.6 + artistDiversity * 0.4);
}

/**
 * Calculate average session duration
 */
async function calculateAvgSessionDuration(userId: string): Promise<number> {
  // Get recent sessions (group by hour)
  const { data: sessions, error } = await supabase
    .from('playback_history')
    .select('listened_at, duration_seconds')
    .eq('user_id', userId)
    .gte('listened_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('listened_at', { ascending: false });

  if (error || !sessions || sessions.length === 0) return 0;

  // Group into sessions (gap > 30 minutes = new session)
  const sessionLengths: number[] = [];
  let currentSessionDuration = 0;
  let lastTimestamp: Date | null = null;

  sessions.forEach(play => {
    const currentTimestamp = new Date(play.listened_at);

    if (lastTimestamp) {
      const gapMinutes = (lastTimestamp.getTime() - currentTimestamp.getTime()) / (1000 * 60);

      if (gapMinutes > 30) {
        // New session
        if (currentSessionDuration > 0) {
          sessionLengths.push(currentSessionDuration);
        }
        currentSessionDuration = play.duration_seconds;
      } else {
        // Same session
        currentSessionDuration += play.duration_seconds;
      }
    } else {
      currentSessionDuration = play.duration_seconds;
    }

    lastTimestamp = currentTimestamp;
  });

  // Add last session
  if (currentSessionDuration > 0) {
    sessionLengths.push(currentSessionDuration);
  }

  // Calculate average
  const avgDuration = sessionLengths.length > 0
    ? sessionLengths.reduce((sum, len) => sum + len, 0) / sessionLengths.length
    : 0;

  return Math.round(avgDuration);
}

/**
 * Build comprehensive user profile
 */
export async function buildUserProfile(userId: string): Promise<UserProfile> {
  // Get configuration
  const { data: config } = await supabase
    .from('daily_mix_config')
    .select('*')
    .single();

  const minDuration = config?.min_play_duration_seconds || 30;
  const skipThreshold = config?.skip_threshold_seconds || 15;

  // Get listening history
  const playbacks = await getUserListeningStats(userId, minDuration);

  // Calculate all components
  const [topGenres, topMoods, topArtists, avgSessionDuration] = await Promise.all([
    calculateGenrePreferences(userId, playbacks),
    calculateMoodPreferences(userId, playbacks),
    calculateArtistPreferences(userId, playbacks),
    calculateAvgSessionDuration(userId)
  ]);

  const listeningTimePatterns = calculateListeningTimePatterns(playbacks);
  const skipRate = calculateSkipRate(playbacks, skipThreshold);
  const completionRate = calculateCompletionRate(playbacks);
  const diversityScore = calculateDiversityScore(topGenres, topArtists);

  return {
    user_id: userId,
    top_genres: topGenres,
    top_moods: topMoods,
    top_artists: topArtists,
    listening_time_patterns: listeningTimePatterns,
    avg_session_duration: avgSessionDuration,
    skip_rate: skipRate,
    completion_rate: completionRate,
    diversity_score: diversityScore
  };
}

/**
 * Save user profile to database
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const { error } = await supabase
    .from('user_music_preferences')
    .upsert({
      user_id: profile.user_id,
      top_genres: profile.top_genres,
      top_moods: profile.top_moods,
      top_artists: profile.top_artists,
      listening_time_patterns: profile.listening_time_patterns,
      avg_session_duration: profile.avg_session_duration,
      skip_rate: profile.skip_rate,
      completion_rate: profile.completion_rate,
      diversity_score: profile.diversity_score,
      last_updated: new Date().toISOString()
    });

  if (error) throw error;
}

/**
 * Get cached user profile
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_music_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    user_id: data.user_id,
    top_genres: data.top_genres || [],
    top_moods: data.top_moods || [],
    top_artists: data.top_artists || [],
    listening_time_patterns: data.listening_time_patterns || {},
    avg_session_duration: data.avg_session_duration || 0,
    skip_rate: data.skip_rate || 0,
    completion_rate: data.completion_rate || 0,
    diversity_score: data.diversity_score || 0.5
  };
}

/**
 * Update user profile (build and save)
 */
export async function updateUserProfile(userId: string): Promise<UserProfile> {
  const profile = await buildUserProfile(userId);
  await saveUserProfile(profile);
  return profile;
}
