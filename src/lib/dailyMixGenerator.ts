/**
 * Daily Mix Generator Service
 *
 * Orchestrates the generation of personalized daily mix playlists
 * Combines user preferences, recommendations, and clustering logic
 * to create multiple themed mixes per user
 */

import { supabase } from './supabase';
import { getUserProfile, updateUserProfile, type UserProfile } from './userPreferenceProfiler';
import { generateRecommendations, type SongRecommendation } from './recommendationEngine';
import { fetchWithCache, CACHE_KEYS, CACHE_TTL } from './configCache';
import {
  getCreativeMixTitle,
  getCreativeMixTitleByIndex,
  CREATIVE_MIX_TITLES,
} from './dailyMixTitles';

interface DailyMixConfig {
  enabled: boolean;
  mixes_per_user: number;
  tracks_per_mix: number;
  familiar_ratio: number;
  min_play_duration_seconds: number;
  skip_threshold_seconds: number;
  refresh_hour: number;
}

interface DailyMix {
  mix_number: number;
  title: string;
  description: string;
  genre_focus: string | null;
  mood_focus: string | null;
  cover_image_url: string | null;
  tracks: SongRecommendation[];
}

/**
 * Get daily mix configuration
 */
async function getConfig(): Promise<DailyMixConfig> {
  return fetchWithCache(
    CACHE_KEYS.DAILY_MIX_CONFIG,
    CACHE_TTL.ONE_DAY,
    async () => {
      const { data, error } = await supabase
        .from('daily_mix_config')
        .select(
          [
            'enabled',
            'mixes_per_user',
            'tracks_per_mix',
            'familiar_ratio',
            'min_play_duration_seconds',
            'skip_threshold_seconds',
            'refresh_hour',
          ].join(', ')
        )
        .single();

      if (error || !data) {
        throw new Error('Failed to load daily mix configuration');
      }

      return data as DailyMixConfig;
    }
  );
}

/**
 * Check if user already has fresh mixes
 */
async function hasFreshMixes(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('daily_mix_playlists')
    .select('id')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .limit(1);

  return (data?.length || 0) > 0;
}

/**
 * Cluster recommendations by genre/mood
 */
function clusterRecommendations(
  recommendations: SongRecommendation[],
  userProfile: UserProfile,
  numClusters: number
): Array<{ genre?: string; mood?: string; tracks: SongRecommendation[] }> {
  const clusters: Array<{ genre?: string; mood?: string; tracks: SongRecommendation[] }> = [];

  // Get top genres and moods
  const topGenres = userProfile.top_genres.slice(0, Math.max(2, numClusters - 1));
  const topMoods = userProfile.top_moods.slice(0, Math.max(2, numClusters - 1));

  // Create genre-focused clusters
  topGenres.forEach((genre, idx) => {
    if (idx < numClusters - 1) {
      clusters.push({
        genre: genre.genre_name,
        tracks: []
      });
    }
  });

  // If we don't have enough genre clusters, add mood clusters
  if (clusters.length < numClusters - 1) {
    topMoods.slice(0, numClusters - 1 - clusters.length).forEach(mood => {
      clusters.push({
        mood: mood.mood_name,
        tracks: []
      });
    });
  }

  // Add a discovery cluster (trending + diverse)
  clusters.push({
    genre: 'Discovery',
    tracks: []
  });

  return clusters;
}

/**
 * Get song details for recommendations
 */
async function enrichRecommendations(recommendations: SongRecommendation[]): Promise<SongRecommendation[]> {
  const songIds = recommendations.map(r => r.song_id);

  if (songIds.length === 0) return recommendations;

  const { data: songs } = await supabase
    .from('songs')
    .select(`
      id,
      title,
      artist_id,
      cover_image_url,
      duration_seconds,
      audio_url,
      play_count
    `)
    .in('id', songIds);

  if (!songs) return recommendations;

  const songMap = new Map(songs.map(s => [s.id, s]));

  return recommendations.map(rec => ({
    ...rec,
    song_details: songMap.get(rec.song_id) || rec.song_details
  }));
}

/**
 * Assign recommendations to clusters
 */
async function assignToClusters(
  recommendations: SongRecommendation[],
  clusters: Array<{ genre?: string; mood?: string; tracks: SongRecommendation[] }>,
  userProfile: UserProfile
): Promise<void> {
  // Get genre and mood mappings for songs
  const songIds = recommendations.map(r => r.song_id);

  const { data: genreData } = await supabase
    .from('song_genres')
    .select(`
      song_id,
      genres (
        id,
        name
      )
    `)
    .in('song_id', songIds);

  const { data: moodData } = await supabase
    .from('song_moods')
    .select(`
      song_id,
      moods (
        id,
        name
      ),
      confidence_score
    `)
    .in('song_id', songIds)
    .gte('confidence_score', 0.5);

  // Create mappings
  const songGenres = new Map<string, string[]>();
  const songMoods = new Map<string, string[]>();

  genreData?.forEach(sg => {
    if (sg.genres) {
      const genres = songGenres.get(sg.song_id) || [];
      genres.push(sg.genres.name);
      songGenres.set(sg.song_id, genres);
    }
  });

  moodData?.forEach(sm => {
    if (sm.moods) {
      const moods = songMoods.get(sm.song_id) || [];
      moods.push(sm.moods.name);
      songMoods.set(sm.song_id, moods);
    }
  });

  // Assign each recommendation to best matching cluster
  recommendations.forEach(rec => {
    let bestCluster = clusters[clusters.length - 1]; // Default to discovery
    let bestScore = 0;

    const recGenres = songGenres.get(rec.song_id) || [];
    const recMoods = songMoods.get(rec.song_id) || [];

    clusters.forEach((cluster, idx) => {
      let score = 0;

      // Genre match
      if (cluster.genre && cluster.genre !== 'Discovery') {
        if (recGenres.includes(cluster.genre)) {
          score += 1.0;
        }
      }

      // Mood match
      if (cluster.mood) {
        if (recMoods.includes(cluster.mood)) {
          score += 1.0;
        }
      }

      // Discovery cluster prefers unfamiliar + trending
      if (cluster.genre === 'Discovery') {
        if (rec.recommendation_type === 'trending' || rec.recommendation_type === 'discovery') {
          score += 0.5;
        }
        if (!rec.is_familiar) {
          score += 0.3;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    });

    bestCluster.tracks.push(rec);
  });
}

/**
 * Balance familiar vs discovery tracks in a mix
 */
function balanceFamiliarRatio(
  tracks: SongRecommendation[],
  targetCount: number,
  familiarRatio: number
): SongRecommendation[] {
  const targetFamiliar = Math.round(targetCount * familiarRatio);
  const targetDiscovery = targetCount - targetFamiliar;

  const familiar = tracks.filter(t => t.is_familiar).slice(0, targetFamiliar);
  const discovery = tracks.filter(t => !t.is_familiar).slice(0, targetDiscovery);

  // If we don't have enough of one type, fill with the other
  const combined = [...familiar, ...discovery];

  if (combined.length < targetCount) {
    const remaining = tracks.filter(t => !combined.includes(t)).slice(0, targetCount - combined.length);
    combined.push(...remaining);
  }

  return combined.slice(0, targetCount);
}

/**
 * Generate cover image URL (placeholder for now)
 */
function generateCoverImageUrl(genreFocus: string | null): string | null {
  // In production, this could generate dynamic covers or use genre-specific images
  return null;
}

const CREATIVE_TITLE_COUNT = CREATIVE_MIX_TITLES.length;

/**
 * Get the next N creative title indices for a user (rotating 0..CREATIVE_TITLE_COUNT-1)
 * and persist the new position so the user won't see the same title again until all are seen.
 * Requires table: daily_mix_user_state (user_id uuid PRIMARY KEY, next_creative_title_index int NOT NULL DEFAULT 0).
 * If the table is missing, returns [] and caller should fall back to mix_number-based titles.
 */
async function getAndIncrementNextTitleIndices(userId: string, count: number): Promise<number[]> {
  if (count <= 0) return [];
  try {
    const { data: row, error: selectError } = await supabase
      .from('daily_mix_user_state')
      .select('next_creative_title_index')
      .eq('user_id', userId)
      .maybeSingle();

    if (selectError) return [];

    const current = (row?.next_creative_title_index ?? 0) % CREATIVE_TITLE_COUNT;
    const indices = Array.from({ length: count }, (_, i) => (current + i) % CREATIVE_TITLE_COUNT);
    const nextIndex = (current + count) % CREATIVE_TITLE_COUNT;

    await supabase
      .from('daily_mix_user_state')
      .upsert(
        { user_id: userId, next_creative_title_index: nextIndex },
        { onConflict: 'user_id' }
      );

    return indices;
  } catch {
    return [];
  }
}

/**
 * Create daily mixes for a user
 */
async function createDailyMixes(
  userId: string,
  userProfile: UserProfile,
  config: DailyMixConfig
): Promise<DailyMix[]> {
  // Generate recommendations
  const totalNeeded = config.mixes_per_user * config.tracks_per_mix;
  let recommendations = await generateRecommendations(userId, userProfile, Math.round(totalNeeded * 1.5));

  // Enrich with full song details
  recommendations = await enrichRecommendations(recommendations);

  if (recommendations.length < config.tracks_per_mix) {
    throw new Error('Not enough recommendations to generate mixes');
  }

  // Cluster recommendations
  const clusters = clusterRecommendations(recommendations, userProfile, config.mixes_per_user);
  await assignToClusters(recommendations, clusters, userProfile);

  // Per-user rotating titles: get next indices for Discovery mixes so user doesn't see repeats until all 150 seen
  const discoveryCount = clusters.filter(
    (c) => (c.genre || c.mood || 'Mixed') === 'Discovery'
  ).length;
  const titleIndices = await getAndIncrementNextTitleIndices(userId, discoveryCount);
  let discoveryIdx = 0;

  // Create mixes from clusters
  const mixes: DailyMix[] = clusters.map((cluster, idx) => {
    const tracks = balanceFamiliarRatio(
      cluster.tracks,
      config.tracks_per_mix,
      config.familiar_ratio
    );

    // Shuffle tracks for variety
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }

    const genreFocus = cluster.genre || cluster.mood || 'Mixed';
    const isDiscovery = genreFocus === 'Discovery';
    const mixNumber = idx + 1;

    const title =
      isDiscovery && discoveryIdx < titleIndices.length
        ? getCreativeMixTitleByIndex(titleIndices[discoveryIdx++])
        : isDiscovery
          ? getCreativeMixTitle(mixNumber)
          : `Your ${genreFocus} Mix`;

    return {
      mix_number: mixNumber,
      title,
      description: isDiscovery
        ? 'Fresh tracks trending globally and new discoveries based on your taste'
        : `A personalized mix featuring ${genreFocus.toLowerCase()} tracks you'll love`,
      genre_focus: cluster.genre || null,
      mood_focus: cluster.mood || null,
      cover_image_url: generateCoverImageUrl(genreFocus),
      tracks
    };
  });

  return mixes;
}

/**
 * Save mixes to database
 */
async function saveMixesToDatabase(userId: string, mixes: DailyMix[]): Promise<void> {
  // Delete old mixes
  await supabase
    .from('daily_mix_playlists')
    .delete()
    .eq('user_id', userId);

  // Insert new mixes
  for (const mix of mixes) {
    const { data: playlist, error: playlistError } = await supabase
      .from('daily_mix_playlists')
      .insert({
        user_id: userId,
        mix_number: mix.mix_number,
        title: mix.title,
        description: mix.description,
        genre_focus: mix.genre_focus,
        mood_focus: mix.mood_focus,
        cover_image_url: mix.cover_image_url,
        track_count: mix.tracks.length,
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (playlistError) throw playlistError;

    // Insert tracks
    const tracksToInsert = mix.tracks.map((track, idx) => ({
      mix_id: playlist.id,
      song_id: track.song_id,
      position: idx + 1,
      recommendation_score: track.score,
      explanation: track.explanation,
      recommendation_type: track.recommendation_type,
      is_familiar: track.is_familiar
    }));

    const { error: tracksError } = await supabase
      .from('daily_mix_tracks')
      .insert(tracksToInsert);

    if (tracksError) throw tracksError;
  }
}

/**
 * Generate daily mixes for a user
 */
export async function generateDailyMixesForUser(userId: string, forceRefresh: boolean = false): Promise<DailyMix[]> {
  // Get configuration
  const config = await getConfig();

  if (!config.enabled) {
    throw new Error('Daily mix system is disabled');
  }

  // Check if user already has fresh mixes
  if (!forceRefresh && await hasFreshMixes(userId)) {
    return getUserDailyMixes(userId);
  }

  // Get or build user profile
  let userProfile = await getUserProfile(userId);

  if (!userProfile || userProfile.top_genres.length === 0) {
    // Build profile if it doesn't exist or is empty
    userProfile = await updateUserProfile(userId);
  }

  if (!userProfile || userProfile.top_genres.length === 0) {
    throw new Error('Insufficient listening history to generate mixes');
  }

  // Generate mixes
  const mixes = await createDailyMixes(userId, userProfile, config);

  // Save to database
  await saveMixesToDatabase(userId, mixes);

  return mixes;
}

/**
 * Get user's current daily mixes
 */
export async function getUserDailyMixes(userId: string): Promise<DailyMix[]> {
  const { data: playlists, error } = await supabase
    .from('daily_mix_playlists')
    .select(`
      id,
      mix_number,
      title,
      description,
      genre_focus,
      mood_focus,
      cover_image_url,
      track_count
    `)
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('mix_number');

  if (error) throw error;

  if (!playlists || playlists.length === 0) {
    return [];
  }

  // Get tracks for each mix
  const mixes: DailyMix[] = [];

  for (const playlist of playlists) {
    const { data: tracks } = await supabase
      .from('daily_mix_tracks')
      .select(`
        song_id,
        position,
        recommendation_score,
        explanation,
        recommendation_type,
        is_familiar,
        songs (
          id,
          title,
          artist_id,
          cover_image_url,
          duration_seconds,
          audio_url,
          play_count
        )
      `)
      .eq('mix_id', playlist.id)
      .order('position');

    mixes.push({
      mix_number: playlist.mix_number,
      title: playlist.title,
      description: playlist.description || '',
      genre_focus: playlist.genre_focus,
      mood_focus: playlist.mood_focus,
      cover_image_url: playlist.cover_image_url,
      tracks: (tracks || []).map(t => ({
        song_id: t.song_id,
        score: parseFloat(t.recommendation_score),
        explanation: t.explanation,
        recommendation_type: t.recommendation_type,
        is_familiar: t.is_familiar,
        song_details: t.songs
      }))
    });
  }

  return mixes;
}

/**
 * Update mix play statistics
 */
export async function recordMixPlay(userId: string, mixNumber: number): Promise<void> {
  await supabase
    .from('daily_mix_playlists')
    .update({
      play_count: supabase.sql`play_count + 1`,
      last_played_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .eq('mix_number', mixNumber);
}

/**
 * Record track interaction in mix
 */
export async function recordMixTrackInteraction(
  mixId: string,
  songId: string,
  interaction: 'played' | 'skipped' | 'saved'
): Promise<void> {
  const updates: Record<string, boolean> = {};
  updates[interaction] = true;

  await supabase
    .from('daily_mix_tracks')
    .update(updates)
    .eq('mix_id', mixId)
    .eq('song_id', songId);
}

/**
 * Batch generate mixes for multiple users
 */
export async function batchGenerateMixes(userIds: string[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      await generateDailyMixesForUser(userId, false);
      success++;
    } catch (error) {
      console.error(`Failed to generate mixes for user ${userId}:`, error);
      failed++;
    }
  }

  return { success, failed };
}
