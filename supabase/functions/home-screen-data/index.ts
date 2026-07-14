import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// Helper function to get threshold for a section
async function getSectionThreshold(
  supabase: any,
  sectionKey: string
): Promise<{ min_play_count: number; min_like_count: number; time_window_days: number | null }> {
  const { data, error } = await supabase
    .from('content_section_thresholds')
    .select('min_play_count, min_like_count, time_window_days')
    .eq('section_key', sectionKey)
    .eq('is_enabled', true)
    .single();

  if (error || !data) {
    // Return defaults if threshold not found
    return { min_play_count: 0, min_like_count: 0, time_window_days: null };
  }

  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // First, fetch all thresholds in parallel
    const [globalTrendingThreshold, newReleasesThreshold, trendingAlbumsThreshold, blowingUpThreshold] = await Promise.all([
      getSectionThreshold(supabase, 'global_trending'),
      getSectionThreshold(supabase, 'new_releases'),
      getSectionThreshold(supabase, 'trending_albums'),
      getSectionThreshold(supabase, 'blowing_up'),
    ]);

    // Calculate date cutoff if time window is specified
    const getDateCutoff = (timeWindowDays: number | null) => {
      if (!timeWindowDays) return null;
      const date = new Date();
      date.setDate(date.getDate() - timeWindowDays);
      return date.toISOString();
    };

    // Build trending songs query (Global Trending)
    const trendingSongsQuery = supabase
      .from('songs')
      .select('id, title, artist_id, cover_image_url, audio_url, duration_seconds, play_count, created_at, featured_artists')
      .gte('play_count', globalTrendingThreshold.min_play_count)
      .order('play_count', { ascending: false })
      .limit(20);

    // Apply time window if specified
    const globalTrendingCutoff = getDateCutoff(globalTrendingThreshold.time_window_days);
    if (globalTrendingCutoff) {
      trendingSongsQuery.gte('created_at', globalTrendingCutoff);
    }

    // Build new releases query
    const newReleasesQuery = supabase
      .from('songs')
      .select('id, title, artist_id, cover_image_url, audio_url, duration_seconds, play_count, created_at, featured_artists')
      .gte('play_count', newReleasesThreshold.min_play_count)
      .order('created_at', { ascending: false })
      .limit(20);

    // Apply time window if specified
    const newReleasesCutoff = getDateCutoff(newReleasesThreshold.time_window_days);
    if (newReleasesCutoff) {
      newReleasesQuery.gte('created_at', newReleasesCutoff);
    }

    // Build trending albums query
    const trendingAlbumsQuery = supabase
      .from('albums')
      .select('id, title, artist_id, cover_image_url, created_at, play_count')
      .order('created_at', { ascending: false })
      .limit(10);

    // Note: Albums don't have play_count in the select, so we'll add it if needed
    // For now, keeping the original query structure

    // Now fetch all data
    const [
      trendingSongs,
      newReleases,
      trendingAlbums,
      mustWatch,
      loops,
      topArtists,
      mixForYou,
      promotedContent,
    ] = await Promise.all([
      trendingSongsQuery,
      newReleasesQuery,
      trendingAlbumsQuery,

      supabase
        .from('videos')
        .select('id, title, artist_id, thumbnail_url, total_plays, total_likes, created_at')
        .eq('is_approved', true)
        .order('total_plays', { ascending: false })
        .limit(10),

      supabase
        .from('short_clips')
        .select('id, title, artist_id, thumbnail_url, total_plays, total_likes, created_at')
        .eq('is_approved', true)
        .order('total_plays', { ascending: false })
        .limit(15),

      supabase
        .from('profiles')
        .select('id, username, profile_picture, follower_count, is_verified')
        .eq('is_creator', true)
        .order('follower_count', { ascending: false })
        .limit(10),

      supabase
        .from('mixes')
        .select('id, title, cover_image, total_plays, created_at')
        .eq('is_approved', true)
        .order('created_at', { ascending: false })
        .limit(10),

      supabase
        .from('promotions')
        .select('id, content_id, content_type, section, position')
        .eq('status', 'active')
        .lte('start_date', new Date().toISOString())
        .gte('end_date', new Date().toISOString())
        .order('position', { ascending: true })
        .limit(20),
    ]);

    const data = {
      trendingSongs: trendingSongs.data || [],
      newReleases: newReleases.data || [],
      trendingAlbums: trendingAlbums.data || [],
      mustWatch: mustWatch.data || [],
      loops: loops.data || [],
      topArtists: topArtists.data || [],
      mixForYou: mixForYou.data || [],
      promotedContent: promotedContent.data || [],
      timestamp: Date.now(),
      // Include thresholds in response for debugging
      thresholds: {
        global_trending: globalTrendingThreshold,
        new_releases: newReleasesThreshold,
        trending_albums: trendingAlbumsThreshold,
        blowing_up: blowingUpThreshold,
      },
    };

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('Error fetching home screen data:', error);

    return new Response(
      JSON.stringify({
        error: 'Failed to fetch home screen data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});