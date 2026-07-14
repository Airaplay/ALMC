/**
 * Recommendation Engine with Collaborative Filtering
 *
 * Generates personalized song recommendations using:
 * - Collaborative filtering (similar users)
 * - Content-based filtering (genres, moods, artists)
 * - Trending songs
 * - Quality and anti-abuse filters
 *
 * All recommendations include explanations for transparency
 */

import { supabase } from './supabase';
import type { UserProfile } from './userPreferenceProfiler';
import { fetchWithCache, CACHE_KEYS, CACHE_TTL } from './configCache';

export interface SongRecommendation {
  song_id: string;
  score: number;
  explanation: string;
  recommendation_type: 'collaborative' | 'content_based' | 'trending' | 'discovery' | 'artist_based';
  is_familiar: boolean;
  song_details?: any;
}

interface RecommendationWeights {
  collaborative_filtering_weight: number;
  content_based_weight: number;
  trending_weight: number;
  diversity_bonus: number;
  quality_threshold: number;
}

/**
 * Calculate similarity between two users using cosine similarity
 */
function calculateUserSimilarity(userA: UserProfile, userB: UserProfile): number {
  let genreSimilarity = 0;
  let moodSimilarity = 0;
  let artistSimilarity = 0;

  // Genre similarity
  const genreMapA = new Map(userA.top_genres.map(g => [g.genre_id, g.score]));
  const genreMapB = new Map(userB.top_genres.map(g => [g.genre_id, g.score]));

  const allGenres = new Set([...genreMapA.keys(), ...genreMapB.keys()]);
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  allGenres.forEach(genreId => {
    const scoreA = genreMapA.get(genreId) || 0;
    const scoreB = genreMapB.get(genreId) || 0;
    dotProduct += scoreA * scoreB;
    magnitudeA += scoreA * scoreA;
    magnitudeB += scoreB * scoreB;
  });

  if (magnitudeA > 0 && magnitudeB > 0) {
    genreSimilarity = dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
  }

  // Mood similarity (same calculation)
  const moodMapA = new Map(userA.top_moods.map(m => [m.mood_id, m.score]));
  const moodMapB = new Map(userB.top_moods.map(m => [m.mood_id, m.score]));

  const allMoods = new Set([...moodMapA.keys(), ...moodMapB.keys()]);
  dotProduct = 0;
  magnitudeA = 0;
  magnitudeB = 0;

  allMoods.forEach(moodId => {
    const scoreA = moodMapA.get(moodId) || 0;
    const scoreB = moodMapB.get(moodId) || 0;
    dotProduct += scoreA * scoreB;
    magnitudeA += scoreA * scoreA;
    magnitudeB += scoreB * scoreB;
  });

  if (magnitudeA > 0 && magnitudeB > 0) {
    moodSimilarity = dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
  }

  // Artist overlap (Jaccard similarity)
  const artistSetA = new Set(userA.top_artists.map(a => a.artist_id));
  const artistSetB = new Set(userB.top_artists.map(a => a.artist_id));
  const intersection = new Set([...artistSetA].filter(x => artistSetB.has(x)));
  const union = new Set([...artistSetA, ...artistSetB]);

  if (union.size > 0) {
    artistSimilarity = intersection.size / union.size;
  }

  // Weighted average
  return (genreSimilarity * 0.4 + moodSimilarity * 0.3 + artistSimilarity * 0.3);
}

/**
 * Find similar users using collaborative filtering
 */
export async function findSimilarUsers(userId: string, limit: number = 20): Promise<string[]> {
  // Check if we have cached similar users (updated recently)
  const { data: cached } = await supabase
    .from('similar_users')
    .select('similar_user_id, similarity_score')
    .eq('user_id', userId)
    .gte('computed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // 7 days
    .order('similarity_score', { ascending: false })
    .limit(limit);

  if (cached && cached.length >= Math.min(10, limit)) {
    return cached.map(c => c.similar_user_id);
  }

  // Need to compute similar users
  const { getUserProfile } = await import('./userPreferenceProfiler');
  const userProfile = await getUserProfile(userId);

  if (!userProfile || userProfile.top_genres.length === 0) {
    return [];
  }

  // Get other users with preferences
  const { data: otherUsers } = await supabase
    .from('user_music_preferences')
    .select('user_id')
    .neq('user_id', userId)
    .not('top_genres', 'eq', '[]')
    .limit(500); // Sample for performance

  if (!otherUsers || otherUsers.length === 0) {
    return [];
  }

  // Calculate similarities
  const similarities: Array<{ user_id: string; score: number }> = [];

  for (const otherUser of otherUsers) {
    const otherProfile = await getUserProfile(otherUser.user_id);
    if (otherProfile) {
      const similarity = calculateUserSimilarity(userProfile, otherProfile);
      if (similarity > 0.3) { // Minimum threshold
        similarities.push({ user_id: otherUser.user_id, score: similarity });
      }
    }
  }

  // Sort by similarity
  similarities.sort((a, b) => b.score - a.score);
  const topSimilar = similarities.slice(0, limit);

  // Cache the results
  if (topSimilar.length > 0) {
    await supabase
      .from('similar_users')
      .upsert(
        topSimilar.map(s => ({
          user_id: userId,
          similar_user_id: s.user_id,
          similarity_score: s.score,
          computed_at: new Date().toISOString()
        }))
      );
  }

  return topSimilar.map(s => s.user_id);
}

/**
 * Get collaborative filtering recommendations
 */
async function getCollaborativeRecommendations(
  userId: string,
  userProfile: UserProfile,
  limit: number = 50
): Promise<SongRecommendation[]> {
  const similarUsers = await findSimilarUsers(userId, 20);

  if (similarUsers.length === 0) {
    return [];
  }

  // Get songs that similar users have listened to
  const { data: similarUserPlays } = await supabase
    .from('playback_history')
    .select(`
      song_id,
      songs (
        id,
        title,
        play_count
      )
    `)
    .in('user_id', similarUsers)
    .gte('duration_seconds', 30)
    .gte('listened_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (!similarUserPlays || similarUserPlays.length === 0) {
    return [];
  }

  // Get user's already played songs
  const { data: userPlays } = await supabase
    .from('playback_history')
    .select('song_id')
    .eq('user_id', userId);

  const playedSongIds = new Set(userPlays?.map(p => p.song_id) || []);

  // Count recommendations
  const songScores = new Map<string, { count: number; details: any }>();

  similarUserPlays.forEach(play => {
    if (!playedSongIds.has(play.song_id) && play.songs) {
      const current = songScores.get(play.song_id);
      if (current) {
        current.count++;
      } else {
        songScores.set(play.song_id, { count: 1, details: play.songs });
      }
    }
  });

  // Convert to recommendations with scores
  const recommendations: SongRecommendation[] = Array.from(songScores.entries())
    .map(([songId, data]) => ({
      song_id: songId,
      score: data.count / similarUsers.length, // Normalize by number of similar users
      explanation: `Trending among listeners with similar taste (${data.count} similar users)`,
      recommendation_type: 'collaborative' as const,
      is_familiar: false,
      song_details: data.details
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return recommendations;
}

/**
 * Get content-based recommendations (similar to what user likes)
 */
async function getContentBasedRecommendations(
  userId: string,
  userProfile: UserProfile,
  limit: number = 50
): Promise<SongRecommendation[]> {
  if (userProfile.top_genres.length === 0 && userProfile.top_moods.length === 0) {
    return [];
  }

  // Get genre and mood IDs
  const topGenreIds = userProfile.top_genres.slice(0, 5).map(g => g.genre_id);
  const topMoodIds = userProfile.top_moods.slice(0, 5).map(m => m.mood_id);

  // Get user's already played songs
  const { data: userPlays } = await supabase
    .from('playback_history')
    .select('song_id')
    .eq('user_id', userId);

  const playedSongIds = new Set(userPlays?.map(p => p.song_id) || []);

  // Get songs with matching genres
  const { data: genreMatches } = await supabase
    .from('song_genres')
    .select(`
      song_id,
      genre_id,
      songs (
        id,
        title,
        play_count
      )
    `)
    .in('genre_id', topGenreIds)
    .limit(200);

  // Get songs with matching moods
  const { data: moodMatches } = await supabase
    .from('song_moods')
    .select(`
      song_id,
      mood_id,
      confidence_score,
      songs (
        id,
        title,
        play_count
      )
    `)
    .in('mood_id', topMoodIds)
    .gte('confidence_score', 0.6)
    .limit(200);

  const recommendations = new Map<string, SongRecommendation>();

  // Process genre matches
  const genreScoreMap = new Map(userProfile.top_genres.map(g => [g.genre_id, g.score]));
  genreMatches?.forEach(match => {
    if (!playedSongIds.has(match.song_id) && match.songs) {
      const genreScore = genreScoreMap.get(match.genre_id) || 0;
      const existing = recommendations.get(match.song_id);

      if (existing) {
        existing.score = Math.max(existing.score, genreScore);
      } else {
        recommendations.set(match.song_id, {
          song_id: match.song_id,
          score: genreScore,
          explanation: `Matches your favorite genres`,
          recommendation_type: 'content_based',
          is_familiar: false,
          song_details: match.songs
        });
      }
    }
  });

  // Process mood matches
  const moodScoreMap = new Map(userProfile.top_moods.map(m => [m.mood_id, m.score]));
  moodMatches?.forEach(match => {
    if (!playedSongIds.has(match.song_id) && match.songs) {
      const moodScore = (moodScoreMap.get(match.mood_id) || 0) * parseFloat(match.confidence_score);
      const existing = recommendations.get(match.song_id);

      if (existing) {
        existing.score = Math.max(existing.score, moodScore);
        existing.explanation = `Matches your favorite genres and moods`;
      } else {
        recommendations.set(match.song_id, {
          song_id: match.song_id,
          score: moodScore,
          explanation: `Matches your preferred moods`,
          recommendation_type: 'content_based',
          is_familiar: false,
          song_details: match.songs
        });
      }
    }
  });

  return Array.from(recommendations.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get artist-based recommendations (from favorite artists)
 */
async function getArtistBasedRecommendations(
  userId: string,
  userProfile: UserProfile,
  limit: number = 30
): Promise<SongRecommendation[]> {
  if (userProfile.top_artists.length === 0) {
    return [];
  }

  const topArtistIds = userProfile.top_artists.slice(0, 10).map(a => a.artist_id);

  // Get user's already played songs
  const { data: userPlays } = await supabase
    .from('playback_history')
    .select('song_id')
    .eq('user_id', userId);

  const playedSongIds = new Set(userPlays?.map(p => p.song_id) || []);

  // Get songs from favorite artists
  const { data: artistSongs } = await supabase
    .from('songs')
    .select('id, title, artist_id, play_count')
    .in('artist_id', topArtistIds)
    .order('play_count', { ascending: false })
    .limit(100);

  if (!artistSongs) return [];

  const artistScoreMap = new Map(userProfile.top_artists.map(a => [a.artist_id, a.score]));

  const recommendations: SongRecommendation[] = artistSongs
    .filter(song => !playedSongIds.has(song.id))
    .map(song => {
      const artistScore = artistScoreMap.get(song.artist_id) || 0;
      const artistName = userProfile.top_artists.find(a => a.artist_id === song.artist_id)?.artist_name || 'favorite artist';

      return {
        song_id: song.id,
        score: artistScore,
        explanation: `From ${artistName}, one of your most played artists`,
        recommendation_type: 'artist_based' as const,
        is_familiar: true,
        song_details: song
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return recommendations;
}

/**
 * Get trending recommendations
 */
async function getTrendingRecommendations(
  userId: string,
  limit: number = 30
): Promise<SongRecommendation[]> {
  // Get user's already played songs
  const { data: userPlays } = await supabase
    .from('playback_history')
    .select('song_id')
    .eq('user_id', userId);

  const playedSongIds = new Set(userPlays?.map(p => p.song_id) || []);

  // Get trending songs from last 14 days
  const { data: trending } = await supabase
    .from('playback_history')
    .select(`
      song_id,
      songs (
        id,
        title,
        play_count
      )
    `)
    .gte('listened_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .limit(200);

  if (!trending) return [];

  // Count plays per song
  const songCounts = new Map<string, { count: number; details: any }>();

  trending.forEach(play => {
    if (!playedSongIds.has(play.song_id) && play.songs) {
      const current = songCounts.get(play.song_id);
      if (current) {
        current.count++;
      } else {
        songCounts.set(play.song_id, { count: 1, details: play.songs });
      }
    }
  });

  const maxCount = Math.max(...Array.from(songCounts.values()).map(v => v.count), 1);

  const recommendations: SongRecommendation[] = Array.from(songCounts.entries())
    .map(([songId, data]) => ({
      song_id: songId,
      score: data.count / maxCount,
      explanation: `Trending globally with ${data.count} recent plays`,
      recommendation_type: 'trending' as const,
      is_familiar: false,
      song_details: data.details
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return recommendations;
}

/**
 * Apply diversity bonus to recommendations
 */
function applyDiversityBonus(
  recommendations: SongRecommendation[],
  diversityBonus: number
): SongRecommendation[] {
  const seenArtists = new Set<string>();
  const seenGenres = new Set<string>();

  return recommendations.map(rec => {
    let bonus = 0;

    // Bonus for new artists
    const artistId = rec.song_details?.artist_id;
    if (artistId && !seenArtists.has(artistId)) {
      bonus += diversityBonus * 0.5;
      seenArtists.add(artistId);
    }

    return {
      ...rec,
      score: rec.score + bonus
    };
  });
}

/**
 * Generate combined recommendations
 */
export async function generateRecommendations(
  userId: string,
  userProfile: UserProfile,
  totalLimit: number = 100
): Promise<SongRecommendation[]> {
  // Get configuration
  const config = await fetchWithCache(
    CACHE_KEYS.DAILY_MIX_CONFIG,
    CACHE_TTL.ONE_DAY,
    async () => {
      const { data } = await supabase
        .from('daily_mix_config')
        .select('collaborative_filtering_weight, content_based_weight, trending_weight, diversity_bonus, quality_threshold')
        .single();
      return data;
    }
  );

  const weights: RecommendationWeights = {
    collaborative_filtering_weight: config?.collaborative_filtering_weight || 0.4,
    content_based_weight: config?.content_based_weight || 0.4,
    trending_weight: config?.trending_weight || 0.2,
    diversity_bonus: config?.diversity_bonus || 0.1,
    quality_threshold: config?.quality_threshold || 0.3
  };

  // Get recommendations from each source
  const [collaborative, contentBased, artistBased, trending] = await Promise.all([
    getCollaborativeRecommendations(userId, userProfile, 50),
    getContentBasedRecommendations(userId, userProfile, 50),
    getArtistBasedRecommendations(userId, userProfile, 30),
    getTrendingRecommendations(userId, 30)
  ]);

  // Combine and weight recommendations
  const combined = new Map<string, SongRecommendation>();

  // Add collaborative
  collaborative.forEach(rec => {
    rec.score *= weights.collaborative_filtering_weight;
    combined.set(rec.song_id, rec);
  });

  // Add content-based
  contentBased.forEach(rec => {
    const existing = combined.get(rec.song_id);
    if (existing) {
      existing.score += rec.score * weights.content_based_weight;
      existing.explanation += ` and ${rec.explanation.toLowerCase()}`;
    } else {
      rec.score *= weights.content_based_weight;
      combined.set(rec.song_id, rec);
    }
  });

  // Add artist-based
  artistBased.forEach(rec => {
    const existing = combined.get(rec.song_id);
    if (existing) {
      existing.score += rec.score * 0.3; // Bonus for artist match
      existing.is_familiar = true;
    } else {
      rec.score *= 0.3;
      combined.set(rec.song_id, rec);
    }
  });

  // Add trending
  trending.forEach(rec => {
    const existing = combined.get(rec.song_id);
    if (existing) {
      existing.score += rec.score * weights.trending_weight;
    } else {
      rec.score *= weights.trending_weight;
      combined.set(rec.song_id, rec);
    }
  });

  // Convert to array and apply diversity bonus
  let recommendations = Array.from(combined.values());
  recommendations = applyDiversityBonus(recommendations, weights.diversity_bonus);

  // Filter by quality threshold
  recommendations = recommendations.filter(rec => rec.score >= weights.quality_threshold);

  // Sort and return top recommendations
  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, totalLimit);
}
