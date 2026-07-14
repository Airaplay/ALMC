import { supabase } from './supabase';
import { insertNotificationSafe } from './notificationService';

// In-memory cache for collaboration matches
const matchCache = new Map<string, { matches: CollaborationMatch[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export interface CollaborationMatch {
  id: string;
  matchedArtist: {
    id: string;
    userId: string;
    stageName: string;
    profilePhotoUrl: string | null;
    bio: string | null;
    country: string | null;
    isVerified: boolean;
    genres: string[];
    followerCount: number;
    totalPlays: number;
  };
  compatibilityScore: number;
  matchFactors: {
    genreMatch: number;
    audienceOverlap: number;
    locationProximity: number;
    trendingScore: number;
    activityLevel: number;
  };
  genreOverlap: string[];
}

export interface CollaborationRequest {
  id: string;
  senderArtistId: string;
  recipientArtistId: string;
  message: string;
  collabType: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  createdAt: string;
}

/**
 * Normalize genre names for better matching
 */
function normalizeGenre(genre: string): string {
  return genre
    .toLowerCase()
    .replace(/[\s-_]/g, '') // Remove spaces, hyphens, underscores
    .replace(/&/g, 'and');
}

/**
 * Check if two genres are related
 */
function areGenresRelated(genre1: string, genre2: string): boolean {
  const g1 = normalizeGenre(genre1);
  const g2 = normalizeGenre(genre2);

  // Exact match
  if (g1 === g2) return true;

  // One contains the other (e.g., "afrobeats" contains "afro")
  if (g1.includes(g2) || g2.includes(g1)) {
    // But avoid false positives like "pop" matching "kpop"
    if ((g1 === 'pop' || g2 === 'pop') && (g1.includes('k') || g2.includes('k'))) {
      return false;
    }
    return true;
  }

  // Genre families and related styles
  const relatedGenres: { [key: string]: string[] } = {
    'hiphop': ['rap', 'trap', 'drill'],
    'rap': ['hiphop', 'trap', 'drill'],
    'trap': ['hiphop', 'rap', 'drill'],
    'drill': ['hiphop', 'rap', 'trap'],
    'rnb': ['soul', 'neosoul', 'randb'],
    'soul': ['rnb', 'neosoul', 'randb'],
    'afrobeats': ['afro', 'afropop', 'afrobeat'],
    'afro': ['afrobeats', 'afropop', 'afrobeat'],
    'afropop': ['afrobeats', 'afro', 'afrobeat'],
    'afrobeat': ['afrobeats', 'afro', 'afropop'],
    'dancehall': ['reggae', 'reggaeton'],
    'reggae': ['dancehall', 'reggaeton'],
    'house': ['techno', 'edm', 'electronic'],
    'techno': ['house', 'edm', 'electronic'],
    'edm': ['house', 'techno', 'electronic'],
    'electronic': ['house', 'techno', 'edm'],
    'gospel': ['christian', 'worship'],
    'christian': ['gospel', 'worship'],
    'rock': ['alternative', 'indie'],
    'alternative': ['rock', 'indie'],
    'indie': ['alternative', 'rock'],
  };

  const related1 = relatedGenres[g1] || [];
  const related2 = relatedGenres[g2] || [];

  return related1.includes(g2) || related2.includes(g1);
}

/**
 * Calculate genre similarity between two artists with fuzzy matching
 */
function calculateGenreSimilarity(genres1: string[], genres2: string[]): { score: number; overlap: string[] } {
  if (genres1.length === 0 || genres2.length === 0) {
    return { score: 0, overlap: [] };
  }

  // Find exact and related matches
  const exactMatches: string[] = [];
  const relatedMatches: string[] = [];

  for (const g1 of genres1) {
    for (const g2 of genres2) {
      if (normalizeGenre(g1) === normalizeGenre(g2)) {
        if (!exactMatches.includes(g1.toLowerCase())) {
          exactMatches.push(g1.toLowerCase());
        }
      } else if (areGenresRelated(g1, g2)) {
        if (!relatedMatches.includes(g1.toLowerCase()) && !exactMatches.includes(g1.toLowerCase())) {
          relatedMatches.push(g1.toLowerCase());
        }
      }
    }
  }

  // Calculate score: exact matches count fully, related matches count as 0.5
  const totalMatches = exactMatches.length + (relatedMatches.length * 0.5);
  const avgGenreCount = (genres1.length + genres2.length) / 2;

  // Use average genre count instead of union for more forgiving scoring
  const score = Math.min((totalMatches / avgGenreCount) * 100, 100);

  return {
    score: Math.round(score),
    overlap: [...exactMatches, ...relatedMatches]
  };
}

/**
 * Calculate audience size compatibility (more forgiving)
 * Artists with similar audience sizes tend to collaborate better
 */
function calculateAudienceSimilarity(followers1: number, followers2: number): number {
  // Handle edge cases
  if (followers1 === 0 && followers2 === 0) return 100;
  if (followers1 === 0 || followers2 === 0) return 50;

  const larger = Math.max(followers1, followers2);
  const smaller = Math.min(followers1, followers2);

  // Use logarithmic scale for more forgiving comparison
  // Artists within same order of magnitude get high scores
  const ratio = smaller / larger;

  // Apply curve to be more forgiving
  // 100% match: 100 score
  // 50% match: 85 score
  // 25% match: 70 score
  // 10% match: 50 score
  // 1% match: 20 score
  const score = Math.min(100, 100 * Math.pow(ratio, 0.3));

  return Math.round(score);
}

/**
 * Calculate location proximity score (more balanced)
 */
function calculateLocationProximity(country1: string | null, country2: string | null): number {
  // No location data - neutral score
  if (!country1 || !country2) return 60;

  // Same country - excellent
  if (country1.toLowerCase() === country2.toLowerCase()) return 100;

  // Different countries - still decent for global collaboration
  return 65;
}

/**
 * Calculate trending/activity score (more accessible for new artists)
 */
function calculateTrendingScore(totalPlays: number, recentActivity: number): number {
  // More accessible thresholds for new artists
  // 0-100 plays: 30-45
  // 100-1000 plays: 45-70
  // 1000-5000 plays: 70-90
  // 5000+ plays: 90-100
  const playsScore = Math.min(30 + Math.log10(totalPlays + 1) * 15, 70);

  // Recent activity gives extra boost
  const activityBonus = recentActivity > 0 ? 30 : 0;

  return Math.round(Math.min(playsScore + activityBonus, 100));
}

/**
 * Generate AI-driven collaboration matches for an artist
 */
export async function generateCollaborationMatches(artistId: string): Promise<CollaborationMatch[]> {
  try {
    console.log('[Collab] Starting match generation for artist:', artistId);

    const { data: currentArtist, error: artistError } = await supabase
      .from('artist_profiles')
      .select('id, user_id, stage_name, country')
      .eq('id', artistId)
      .single();

    if (artistError || !currentArtist) {
      console.error('[Collab] Error fetching current artist:', artistError);
      return [];
    }

    console.log('[Collab] Current artist:', currentArtist.stage_name);

    const { data: currentSongs } = await supabase
      .from('songs')
      .select('id, play_count, created_at')
      .eq('artist_id', artistId);

    if (!currentSongs || currentSongs.length === 0) {
      console.log('[Collab] No songs found for current artist');
      return [];
    }

    console.log('[Collab] Found', currentSongs.length, 'songs');

    const songIds = currentSongs.map(s => s.id);

    const { data: currentSongGenres, error: genreError } = await supabase
      .from('song_genres')
      .select(`
        genre_id,
        genres!inner(name)
      `)
      .in('song_id', songIds);

    if (genreError) {
      console.error('[Collab] Error fetching genres:', genreError);
      return [];
    }

    const currentGenres = [...new Set(
      (currentSongGenres || [])
        .map((sg: any) => sg.genres?.name)
        .filter(Boolean)
    )];

    if (currentGenres.length === 0) {
      console.log('[Collab] No genres found for current artist');
      return [];
    }

    console.log('[Collab] Current artist genres:', currentGenres);

    const totalPlays = currentSongs.reduce(
      (sum: number, s: any) => sum + (s.play_count || 0),
      0
    );

    const { count: followerCount } = await supabase
      .from('user_follows')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', currentArtist.user_id);

    const currentFollowers = followerCount || 0;

    const { data: potentialMatches, error: matchesError } = await supabase
      .from('artist_profiles')
      .select('id, user_id, stage_name, profile_photo_url, bio, country, is_verified')
      .neq('id', artistId)
      .limit(50);

    if (matchesError || !potentialMatches) {
      console.error('[Collab] Error fetching potential matches:', matchesError);
      return [];
    }

    console.log('[Collab] Found', potentialMatches.length, 'potential matches to analyze');

    const matches: CollaborationMatch[] = [];

    for (const artist of potentialMatches) {
      const { data: artistSongs } = await supabase
        .from('songs')
        .select('id, play_count, created_at')
        .eq('artist_id', artist.id);

      if (!artistSongs || artistSongs.length === 0) continue;

      const artistSongIds = artistSongs.map(s => s.id);

      const { data: artistSongGenres } = await supabase
        .from('song_genres')
        .select(`
          genre_id,
          genres!inner(name)
        `)
        .in('song_id', artistSongIds);

      const artistGenres = [...new Set(
        (artistSongGenres || [])
          .map((sg: any) => sg.genres?.name)
          .filter(Boolean)
      )];

      if (artistGenres.length === 0) continue;

      const artistTotalPlays = artistSongs.reduce(
        (sum: number, s: any) => sum + (s.play_count || 0),
        0
      );

      const { count: artistFollowerCount } = await supabase
        .from('user_follows')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', artist.user_id);

      const artistFollowers = artistFollowerCount || 0;

      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      const recentSongs = artistSongs.filter((s: any) =>
        new Date(s.created_at) > monthAgo
      ).length;

      const genreMatch = calculateGenreSimilarity(currentGenres, artistGenres);
      const audienceScore = calculateAudienceSimilarity(currentFollowers, artistFollowers);
      const locationScore = calculateLocationProximity(currentArtist.country, artist.country);
      const trendingScore = calculateTrendingScore(artistTotalPlays, recentSongs);

      // Adjusted weights: genre matters most, but other factors balanced
      // Genre: 45% - most important for musical compatibility
      // Audience: 20% - helps find similar-sized artists
      // Trending: 20% - rewards active artists
      // Location: 15% - bonus for proximity, but not critical
      const compatibilityScore = Math.round(
        (genreMatch.score * 0.45) +
        (audienceScore * 0.20) +
        (trendingScore * 0.20) +
        (locationScore * 0.15)
      );

      // Lower threshold from 40 to 30 to show more matches
      if (compatibilityScore >= 30) {
        matches.push({
          id: artist.id,
          matchedArtist: {
            id: artist.id,
            userId: artist.user_id,
            stageName: artist.stage_name,
            profilePhotoUrl: artist.profile_photo_url,
            bio: artist.bio,
            country: artist.country,
            isVerified: artist.is_verified || false,
            genres: artistGenres,
            followerCount: artistFollowers,
            totalPlays: artistTotalPlays
          },
          compatibilityScore,
          matchFactors: {
            genreMatch: genreMatch.score,
            audienceOverlap: audienceScore,
            locationProximity: locationScore,
            trendingScore,
            activityLevel: recentSongs > 0 ? 100 : 50
          },
          genreOverlap: genreMatch.overlap
        });
      }
    }

    matches.sort((a, b) => b.compatibilityScore - a.compatibilityScore);

    console.log('[Collab] Generated', matches.length, 'matches');

    return matches.slice(0, 20);
  } catch (error) {
    console.error('[Collab] Error generating collaboration matches:', error);
    return [];
  }
}

/**
 * Store matches in the pool
 */
async function storeMatchesInPool(artistId: string, matches: CollaborationMatch[]): Promise<void> {
  try {
    await supabase
      .from('collaboration_match_pool')
      .delete()
      .eq('artist_id', artistId);

    const poolEntries = matches.map((match, index) => ({
      artist_id: artistId,
      matched_artist_id: match.matchedArtist.id,
      compatibility_score: match.compatibilityScore,
      match_data: match,
      pool_position: index
    }));

    if (poolEntries.length > 0) {
      await supabase
        .from('collaboration_match_pool')
        .insert(poolEntries);
    }

    console.log('[Collab] Stored', poolEntries.length, 'matches in pool');
  } catch (error) {
    console.error('[Collab] Error storing matches in pool:', error);
  }
}

/**
 * Get 4 random matches from the pool
 */
async function selectVisibleMatches(artistId: string, poolSize: number): Promise<string[]> {
  const visibleCount = Math.min(4, poolSize);
  const allPositions = Array.from({ length: poolSize }, (_, i) => i);

  const shuffled = allPositions.sort(() => Math.random() - 0.5);
  const selectedPositions = shuffled.slice(0, visibleCount);

  const { data: selectedMatches } = await supabase
    .from('collaboration_match_pool')
    .select('matched_artist_id')
    .eq('artist_id', artistId)
    .in('pool_position', selectedPositions);

  return (selectedMatches || []).map(m => m.matched_artist_id);
}

/**
 * Check if rotation needs refresh
 */
async function needsRotationRefresh(artistId: string): Promise<boolean> {
  const { data } = await supabase
    .from('collaboration_rotation_state')
    .select('next_refresh_at, pool_regenerated_at')
    .eq('artist_id', artistId)
    .single();

  if (!data) return true;

  const now = new Date();
  const nextRefresh = new Date(data.next_refresh_at);
  const poolAge = new Date(data.pool_regenerated_at);
  const hoursSincePoolRegen = (now.getTime() - poolAge.getTime()) / (1000 * 60 * 60);

  return now >= nextRefresh || hoursSincePoolRegen > 48;
}

/**
 * Update rotation state
 */
async function updateRotationState(artistId: string, visibleMatchIds: string[]): Promise<void> {
  const now = new Date();
  const nextRefresh = new Date(now.getTime() + 6 * 60 * 60 * 1000);

  const { data: existing } = await supabase
    .from('collaboration_rotation_state')
    .select('id')
    .eq('artist_id', artistId)
    .single();

  if (existing) {
    await supabase
      .from('collaboration_rotation_state')
      .update({
        last_refresh_at: now.toISOString(),
        next_refresh_at: nextRefresh.toISOString(),
        visible_match_ids: visibleMatchIds
      })
      .eq('artist_id', artistId);
  } else {
    await supabase
      .from('collaboration_rotation_state')
      .insert({
        artist_id: artistId,
        last_refresh_at: now.toISOString(),
        next_refresh_at: nextRefresh.toISOString(),
        visible_match_ids: visibleMatchIds,
        pool_regenerated_at: now.toISOString()
      });
  }

  console.log('[Collab] Rotation state updated. Next refresh at:', nextRefresh.toISOString());
}

/**
 * Get collaboration matches for an artist (with 6-hour rotation)
 */
export async function getCollaborationMatches(artistId: string): Promise<CollaborationMatch[]> {
  try {
    // Check memory cache first
    const cached = matchCache.get(artistId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log('[Collab] Returning cached matches');
      return cached.matches;
    }

    const needsRefresh = await needsRotationRefresh(artistId);

    if (needsRefresh) {
      console.log('[Collab] Generating fresh match pool...');
      const allMatches = await generateCollaborationMatches(artistId);

      if (allMatches.length === 0) {
        matchCache.set(artistId, { matches: [], timestamp: Date.now() });
        return [];
      }

      await storeMatchesInPool(artistId, allMatches);
      const visibleIds = await selectVisibleMatches(artistId, allMatches.length);
      await updateRotationState(artistId, visibleIds);

      const filtered = allMatches.filter(m => visibleIds.includes(m.matchedArtist.id));
      matchCache.set(artistId, { matches: filtered, timestamp: Date.now() });
      return filtered;
    }

    const { data: rotationState } = await supabase
      .from('collaboration_rotation_state')
      .select('visible_match_ids')
      .eq('artist_id', artistId)
      .single();

    if (!rotationState || rotationState.visible_match_ids.length === 0) {
      matchCache.set(artistId, { matches: [], timestamp: Date.now() });
      return [];
    }

    const { data: poolMatches } = await supabase
      .from('collaboration_match_pool')
      .select('match_data, matched_artist_id')
      .eq('artist_id', artistId)
      .in('matched_artist_id', rotationState.visible_match_ids);

    if (!poolMatches || poolMatches.length === 0) {
      matchCache.set(artistId, { matches: [], timestamp: Date.now() });
      return [];
    }

    const matches = poolMatches.map(pm => pm.match_data as CollaborationMatch);
    matchCache.set(artistId, { matches, timestamp: Date.now() });

    console.log('[Collab] Loaded', matches.length, 'matches from rotation');
    return matches;
  } catch (error) {
    console.error('Error getting collaboration matches:', error);
    return [];
  }
}

/**
 * Get next refresh time
 */
export async function getNextRefreshTime(artistId: string): Promise<Date | null> {
  try {
    const { data } = await supabase
      .from('collaboration_rotation_state')
      .select('next_refresh_at')
      .eq('artist_id', artistId)
      .single();

    return data ? new Date(data.next_refresh_at) : null;
  } catch (error) {
    console.error('Error getting next refresh time:', error);
    return null;
  }
}

/**
 * Send a collaboration request
 */
export async function sendCollaborationRequest(
  recipientArtistId: string,
  message: string,
  collabType: string = 'feature'
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data: senderProfile } = await supabase
      .from('artist_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!senderProfile) {
      return { success: false, error: 'Artist profile not found' };
    }

    const { data: recipientProfile } = await supabase
      .from('artist_profiles')
      .select('user_id')
      .eq('id', recipientArtistId)
      .single();

    if (!recipientProfile) {
      return { success: false, error: 'Recipient not found' };
    }

    const { data: senderArtistData } = await supabase
      .from('artist_profiles')
      .select('stage_name')
      .eq('id', senderProfile.id)
      .single();

    const { data: newRequest, error } = await supabase
      .from('collaboration_requests')
      .insert({
        sender_artist_id: senderProfile.id,
        sender_user_id: user.id,
        recipient_artist_id: recipientArtistId,
        recipient_user_id: recipientProfile.user_id,
        message,
        collab_type: collabType,
        status: 'pending'
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error sending collaboration request:', error);
      return { success: false, error: error.message };
    }

    await supabase
      .from('collaboration_interactions')
      .insert({
        user_id: user.id,
        artist_id: senderProfile.id,
        matched_artist_id: recipientArtistId,
        interaction_type: 'request_sent'
      });

    await insertNotificationSafe({
      user_id: recipientProfile.user_id,
      title: 'New Collaboration Request',
      message: `${senderArtistData?.stage_name || 'An artist'} sent you a collaboration request`,
      type: 'collaboration_request',
      metadata: { request_id: newRequest?.id },
      is_read: false
    });

    return { success: true };
  } catch (error) {
    console.error('Error sending collaboration request:', error);
    return { success: false, error: 'Failed to send request' };
  }
}

/**
 * Track interaction with a match
 */
export async function trackCollaborationInteraction(
  matchedArtistId: string,
  interactionType: 'view' | 'dismiss' | 'interested'
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: artistProfile } = await supabase
      .from('artist_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!artistProfile) return;

    await supabase
      .from('collaboration_interactions')
      .insert({
        user_id: user.id,
        artist_id: artistProfile.id,
        matched_artist_id: matchedArtistId,
        interaction_type: interactionType
      });
  } catch (error) {
    console.error('Error tracking collaboration interaction:', error);
  }
}

/**
 * Get collaboration requests for current user
 */
export async function getCollaborationRequests(): Promise<CollaborationRequest[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('collaboration_requests')
      .select(`
        id,
        sender_artist_id,
        recipient_artist_id,
        message,
        collab_type,
        status,
        created_at
      `)
      .or(`sender_user_id.eq.${user.id},recipient_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching collaboration requests:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error getting collaboration requests:', error);
    return [];
  }
}
