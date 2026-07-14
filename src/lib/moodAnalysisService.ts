import { supabase } from './supabase';
import { fetchWithCache, CACHE_KEYS, CACHE_TTL } from './configCache';

/**
 * Audio feature analysis for mood detection
 */
interface AudioFeatures {
  tempo: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
}

/**
 * Mood category structure
 */
export interface MoodCategory {
  id: string;
  name: string;
  type: 'mood' | 'activity';
  description: string;
  icon: string;
  color: string;
}

/**
 * Analyze a song's mood based on its metadata and audio characteristics
 */
export async function analyzeSongMood(songId: string): Promise<void> {
  try {
    // Get song details
    const { data: song, error: songError } = await supabase
      .from('songs')
      .select('title, duration_seconds')
      .eq('id', songId)
      .maybeSingle();

    if (songError || !song) {
      console.error('Error fetching song for mood analysis:', songError);
      return;
    }

    // Generate synthetic audio features based on song characteristics
    const features = generateAudioFeatures(null, song.duration_seconds);

    // Determine primary and secondary moods
    const { primary, secondary } = determineMoods(features);

    // Store analysis
    const { error: insertError } = await supabase
      .from('song_mood_analysis')
      .upsert({
        song_id: songId,
        tempo: features.tempo,
        energy: features.energy,
        valence: features.valence,
        danceability: features.danceability,
        acousticness: features.acousticness,
        instrumentalness: features.instrumentalness,
        primary_mood: primary,
        secondary_mood: secondary,
      }, {
        onConflict: 'song_id',
      });

    if (insertError) {
      console.error('Error storing mood analysis:', insertError);
    }
  } catch (error) {
    console.error('Error in analyzeSongMood:', error);
  }
}

/**
 * Batch analyze multiple songs
 */
export async function batchAnalyzeSongs(songIds: string[]): Promise<void> {
  for (const songId of songIds) {
    await analyzeSongMood(songId);
  }
}

/**
 * Generate synthetic audio features based on genre
 */
function generateAudioFeatures(genre: string | null, duration: number): AudioFeatures {
  const genreLower = (genre || 'pop').toLowerCase();

  // Base features by genre
  const genreFeatures: Record<string, Partial<AudioFeatures>> = {
    'hip hop': { tempo: 95, energy: 0.75, valence: 0.65, danceability: 0.80, acousticness: 0.15 },
    'rap': { tempo: 95, energy: 0.75, valence: 0.65, danceability: 0.80, acousticness: 0.15 },
    'pop': { tempo: 120, energy: 0.70, valence: 0.70, danceability: 0.75, acousticness: 0.25 },
    'rock': { tempo: 125, energy: 0.85, valence: 0.55, danceability: 0.50, acousticness: 0.20 },
    'electronic': { tempo: 128, energy: 0.80, valence: 0.60, danceability: 0.85, acousticness: 0.10 },
    'edm': { tempo: 128, energy: 0.85, valence: 0.70, danceability: 0.90, acousticness: 0.05 },
    'jazz': { tempo: 115, energy: 0.45, valence: 0.60, danceability: 0.50, acousticness: 0.60 },
    'classical': { tempo: 100, energy: 0.40, valence: 0.50, danceability: 0.30, acousticness: 0.80 },
    'r&b': { tempo: 90, energy: 0.60, valence: 0.65, danceability: 0.70, acousticness: 0.30 },
    'country': { tempo: 110, energy: 0.60, valence: 0.65, danceability: 0.60, acousticness: 0.50 },
    'reggae': { tempo: 85, energy: 0.55, valence: 0.75, danceability: 0.75, acousticness: 0.35 },
    'blues': { tempo: 90, energy: 0.50, valence: 0.45, danceability: 0.45, acousticness: 0.55 },
    'metal': { tempo: 140, energy: 0.95, valence: 0.40, danceability: 0.40, acousticness: 0.10 },
    'folk': { tempo: 95, energy: 0.40, valence: 0.60, danceability: 0.40, acousticness: 0.75 },
    'indie': { tempo: 115, energy: 0.65, valence: 0.60, danceability: 0.60, acousticness: 0.40 },
    'soul': { tempo: 95, energy: 0.65, valence: 0.70, danceability: 0.65, acousticness: 0.35 },
    'afrobeats': { tempo: 105, energy: 0.80, valence: 0.80, danceability: 0.85, acousticness: 0.20 },
    'dancehall': { tempo: 100, energy: 0.80, valence: 0.75, danceability: 0.85, acousticness: 0.15 },
  };

  // Find matching genre or use default
  const baseFeatures = Object.keys(genreFeatures).find((key) =>
    genreLower.includes(key)
  );

  const base = baseFeatures
    ? genreFeatures[baseFeatures]
    : { tempo: 120, energy: 0.65, valence: 0.60, danceability: 0.65, acousticness: 0.30 };

  // Add randomness for variety (±10%)
  const randomize = (value: number) => value + (Math.random() - 0.5) * 0.2;

  return {
    tempo: base.tempo! + (Math.random() - 0.5) * 20,
    energy: Math.max(0, Math.min(1, randomize(base.energy!))),
    valence: Math.max(0, Math.min(1, randomize(base.valence!))),
    danceability: Math.max(0, Math.min(1, randomize(base.danceability!))),
    acousticness: Math.max(0, Math.min(1, randomize(base.acousticness!))),
    instrumentalness: Math.random() * 0.3,
  };
}

/**
 * Determine primary and secondary moods based on audio features
 */
function determineMoods(features: AudioFeatures): { primary: string; secondary: string | null } {
  const scores: Record<string, number> = {};

  // Mood detection rules
  if (features.valence > 0.7 && features.energy > 0.7) {
    scores['Happy'] = (scores['Happy'] || 0) + 10;
    scores['Energetic'] = (scores['Energetic'] || 0) + 8;
  }

  if (features.valence < 0.4 && features.energy < 0.5) {
    scores['Sad'] = (scores['Sad'] || 0) + 10;
    scores['Chill'] = (scores['Chill'] || 0) + 5;
  }

  if (features.energy > 0.75 && features.danceability > 0.75) {
    scores['Party'] = (scores['Party'] || 0) + 10;
    scores['Workout'] = (scores['Workout'] || 0) + 8;
  }

  if (features.acousticness > 0.6 && features.energy < 0.5) {
    scores['Peaceful'] = (scores['Peaceful'] || 0) + 10;
    scores['Study'] = (scores['Study'] || 0) + 7;
  }

  if (features.tempo > 130 && features.energy > 0.7) {
    scores['Energetic'] = (scores['Energetic'] || 0) + 9;
    scores['Workout'] = (scores['Workout'] || 0) + 8;
  }

  if (features.valence > 0.6 && features.energy < 0.6) {
    scores['Chill'] = (scores['Chill'] || 0) + 9;
    scores['Peaceful'] = (scores['Peaceful'] || 0) + 6;
  }

  if (features.valence < 0.5 && features.energy > 0.6) {
    scores['Angry'] = (scores['Angry'] || 0) + 8;
    scores['Focus'] = (scores['Focus'] || 0) + 5;
  }

  if (features.danceability > 0.7 && features.valence > 0.6) {
    scores['Party'] = (scores['Party'] || 0) + 8;
    scores['Happy'] = (scores['Happy'] || 0) + 6;
  }

  if (features.instrumentalness > 0.5) {
    scores['Study'] = (scores['Study'] || 0) + 8;
    scores['Focus'] = (scores['Focus'] || 0) + 7;
  }

  if (features.tempo < 90 && features.energy < 0.5) {
    scores['Sleep'] = (scores['Sleep'] || 0) + 9;
    scores['Peaceful'] = (scores['Peaceful'] || 0) + 7;
  }

  if (features.valence > 0.5 && features.acousticness > 0.4) {
    scores['Romantic'] = (scores['Romantic'] || 0) + 8;
  }

  // Sort by score
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  return {
    primary: sorted[0]?.[0] || 'Happy',
    secondary: sorted[1]?.[0] || null,
  };
}

/**
 * Get all mood categories
 */
export async function getMoodCategories(): Promise<MoodCategory[]> {
  return fetchWithCache(
    CACHE_KEYS.MOOD_CATEGORIES,
    CACHE_TTL.ONE_DAY,
    async () => {
      const { data, error } = await supabase
        .from('mood_categories')
        .select('id, name, type, description, icon, color')
        .order('name');

      if (error) {
        console.error('Error fetching mood categories:', error);
        return [];
      }

      return data || [];
    }
  );
}

/**
 * Get recently shown mood songs from session storage
 */
function getRecentlyShownMoodSongs(moodName: string): string[] {
  try {
    const key = `mood_session_${moodName}`;
    const stored = localStorage.getItem(key);

    if (!stored) return [];

    const session = JSON.parse(stored);
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);

    // Clear if older than 24 hours
    if (session.timestamp < dayAgo) {
      localStorage.removeItem(key);
      return [];
    }

    return session.shownSongIds || [];
  } catch (error) {
    console.error('Error reading mood session:', error);
    return [];
  }
}

/**
 * Track shown songs to avoid repetition
 */
function trackShownMoodSongs(moodName: string, songIds: string[]): void {
  try {
    const key = `mood_session_${moodName}`;
    const existing = getRecentlyShownMoodSongs(moodName);

    // Combine with existing, keep last 100 unique songs
    const combined = [...new Set([...songIds, ...existing])].slice(0, 100);

    localStorage.setItem(key, JSON.stringify({
      moodName,
      shownSongIds: combined,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Error tracking mood session:', error);
  }
}

/**
 * Weighted random selection for variety
 */
function weightedRandomSelection(
  songs: any[],
  limit: number,
  weights: { popularityWeight: number; freshnessWeight: number; diversityWeight: number }
): any[] {
  if (songs.length === 0) return [];
  if (songs.length <= limit) return songs;

  // Calculate composite scores
  const scoredSongs = songs.map(song => {
    const now = Date.now();
    const songAge = now - new Date(song.created_at || '2020-01-01').getTime();
    const daysOld = songAge / (1000 * 60 * 60 * 24);

    // Popularity score (normalized 0-1)
    const maxPlays = Math.max(...songs.map(s => s.play_count || 0), 1);
    const popularityScore = maxPlays > 0 ? (song.play_count || 0) / maxPlays : 0;

    // Freshness score (newer = higher score, max 1 year window)
    const freshnessScore = Math.max(0, 1 - (daysOld / 365));

    // Diversity score (random component for variety)
    const diversityScore = Math.random();

    // Composite score
    const compositeScore =
      (popularityScore * weights.popularityWeight) +
      (freshnessScore * weights.freshnessWeight) +
      (diversityScore * weights.diversityWeight);

    return { ...song, _score: compositeScore };
  });

  // Sort by composite score and take top N
  return scoredSongs
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...song }) => song); // Remove internal score
}

/**
 * Get songs by mood with variety and freshness
 */
export async function getSongsByMood(moodName: string, limit: number = 50): Promise<any[]> {
  try {
    // Fetch 100 songs max for performance
    const fetchLimit = 100;

    // Get recently shown songs to filter in query
    const recentlyShown = getRecentlyShownMoodSongs(moodName);

    // Build query with optimized ordering
    let query = supabase
      .from('song_mood_analysis')
      .select(`
        song_id,
        primary_mood,
        songs!inner (
          id,
          title,
          cover_image_url,
          audio_url,
          play_count,
          created_at,
          artist_id,
          artists!inner (
            id,
            name
          )
        )
      `)
      .or(`primary_mood.eq.${moodName.replace(/[\\',().]/g, ' ')},secondary_mood.eq.${moodName.replace(/[\\',().]/g, ' ')}`)
      .limit(fetchLimit);

    // Filter out recently shown songs if any (use array for parameterized in-clause)
    if (recentlyShown.length > 0) {
      query = query.not('song_id', 'in', `(${recentlyShown.join(',')})`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching songs by mood:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Map to consistent format
    const allSongs = data
      .map((item: any) => ({
        song_id: item.song_id,
        title: item.songs?.title,
        artist_id: item.songs?.artist_id,
        artist_name: item.songs?.artists?.name || 'Unknown Artist',
        cover_image_url: item.songs?.cover_image_url,
        audio_url: item.songs?.audio_url,
        mood_score: item.primary_mood === moodName ? 100 : 75,
        play_count: item.songs?.play_count || 0,
        created_at: item.songs?.created_at,
      }))
      .filter((song: any) => song.title && song.audio_url);

    // Simplified selection: sort by play count with randomness
    const selected = allSongs
      .sort((a, b) => {
        // Mix of popularity and randomness
        const scoreA = (a.play_count || 0) * 0.6 + Math.random() * 100;
        const scoreB = (b.play_count || 0) * 0.6 + Math.random() * 100;
        return scoreB - scoreA;
      })
      .slice(0, limit);

    // Track shown songs to avoid future repetition
    trackShownMoodSongs(moodName, selected.map(s => s.song_id));

    console.log(`[MoodDiscovery] ${moodName}: Fetched ${allSongs.length}, selected ${selected.length}`);

    return selected;
  } catch (error) {
    console.error('Error in getSongsByMood:', error);
    return [];
  }
}

/**
 * Get personalized mood recommendations for a user
 */
export async function getPersonalizedMoodRecommendations(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_mood_preferences')
    .select('mood_category_id, listen_count, mood_categories(name)')
    .eq('user_id', userId)
    .order('listen_count', { ascending: false })
    .limit(5);

  if (error || !data) {
    return ['Happy', 'Energetic', 'Chill'];
  }

  return data.map((pref: any) => pref.mood_categories?.name).filter(Boolean);
}

/**
 * Update user mood preference
 */
export async function updateUserMoodPreference(
  userId: string,
  moodCategoryId: string,
  increment: number = 1
): Promise<void> {
  try {
    const { error } = await supabase.rpc('increment_user_mood_preference', {
      p_user_id: userId,
      p_mood_category_id: moodCategoryId,
      p_increment: increment,
    });

    if (error) {
      // Fallback: manual upsert
      const { data: existing } = await supabase
        .from('user_mood_preferences')
        .select('listen_count')
        .eq('user_id', userId)
        .eq('mood_category_id', moodCategoryId)
        .maybeSingle();

      await supabase.from('user_mood_preferences').upsert({
        user_id: userId,
        mood_category_id: moodCategoryId,
        listen_count: (existing?.listen_count || 0) + increment,
      });
    }
  } catch (error) {
    console.error('Error updating user mood preference:', error);
  }
}

/**
 * Log user mood selection for analytics
 */
export async function logMoodSelection(userId: string, moodCategoryId: string): Promise<void> {
  try {
    await supabase.from('user_mood_history').insert({
      user_id: userId,
      mood_category_id: moodCategoryId,
    });
  } catch (error) {
    console.error('Error logging mood selection:', error);
  }
}

/**
 * Get mood insights for a user
 */
export async function getUserMoodInsights(userId: string): Promise<any> {
  const { data, error } = await supabase
    .from('user_mood_preferences')
    .select(`
      listen_count,
      last_listened_at,
      mood_categories (
        name,
        type,
        description
      )
    `)
    .eq('user_id', userId)
    .order('listen_count', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching user mood insights:', error);
    return { top_moods: [], total_listens: 0 };
  }

  return {
    top_moods: data || [],
    total_listens: (data || []).reduce((sum: number, item: any) => sum + item.listen_count, 0),
  };
}

/**
 * Clear mood session data (useful for testing or manual reset)
 */
export function clearMoodSessions(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('mood_session_')) {
        localStorage.removeItem(key);
      }
    });
    console.log('[MoodDiscovery] Session data cleared');
  } catch (error) {
    console.error('Error clearing mood sessions:', error);
  }
}

/**
 * Clear specific mood session
 */
export function clearMoodSession(moodName: string): void {
  try {
    const key = `mood_session_${moodName}`;
    localStorage.removeItem(key);
    console.log(`[MoodDiscovery] Session cleared for ${moodName}`);
  } catch (error) {
    console.error('Error clearing mood session:', error);
  }
}
