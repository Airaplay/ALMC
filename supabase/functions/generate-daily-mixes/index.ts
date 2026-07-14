/**
 * Generate Daily Mixes Edge Function
 *
 * Batch processes daily mix generation for all active users
 * Should be scheduled to run daily (via cron job or scheduled event)
 *
 * Features:
 * - Batch processing with rate limiting
 * - Error handling and logging
 * - Progress tracking
 * - Admin-only access
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface GenerationResult {
  total_users: number;
  successful: number;
  failed: number;
  duration_seconds: number;
  errors: Array<{ user_id: string; error: string }>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify access - either admin user or internal service call (no user token)
    const authHeader = req.headers.get('Authorization');
    let isInternalCall = false;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);

      if (user) {
        const { data: userData } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single();

        if (userData?.role !== 'admin') {
          return new Response(
            JSON.stringify({ error: 'Admin access required' }),
            {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      } else {
        isInternalCall = true;
      }
    }

    // Get configuration
    const { data: config, error: configError } = await supabase
      .from('daily_mix_config')
      .select('*')
      .single();

    if (configError || !config || !config.enabled) {
      return new Response(
        JSON.stringify({ error: 'Daily mix system is disabled' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Internal (cron) calls must also have auto_generate enabled
    if (isInternalCall && !config.auto_generate) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'Auto generate is disabled' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get all users with sufficient listening history
    const minPlaysRequired = 20;
    const { data: activeUsers, error: usersError } = await supabase
      .from('listening_history')
      .select('user_id')
      .gte('listened_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .gte('duration_listened', config.min_play_duration_seconds);

    if (usersError) {
      throw usersError;
    }

    // Count plays per user
    const userPlayCounts = new Map<string, number>();
    activeUsers?.forEach((play: any) => {
      const count = userPlayCounts.get(play.user_id) || 0;
      userPlayCounts.set(play.user_id, count + 1);
    });

    // Filter users with enough plays
    const eligibleUserIds = Array.from(userPlayCounts.entries())
      .filter(([_, count]) => count >= minPlaysRequired)
      .map(([userId, _]) => userId);

    console.log(`Found ${eligibleUserIds.length} eligible users for mix generation`);

    // Process in batches to avoid timeouts
    const batchSize = 10;
    const result: GenerationResult = {
      total_users: eligibleUserIds.length,
      successful: 0,
      failed: 0,
      duration_seconds: 0,
      errors: []
    };

    for (let i = 0; i < eligibleUserIds.length; i += batchSize) {
      const batch = eligibleUserIds.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (userId) => {
          try {
            // Call the mix generation logic
            await generateMixesForUser(supabase, userId, config);
            result.successful++;
            console.log(`Generated mixes for user ${userId}`);
          } catch (error) {
            result.failed++;
            result.errors.push({
              user_id: userId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            console.error(`Failed to generate mixes for user ${userId}:`, error);
          }
        })
      );

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    result.duration_seconds = (Date.now() - startTime) / 1000;

    console.log(`Mix generation complete. Success: ${result.successful}, Failed: ${result.failed}`);

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in generate-daily-mixes:', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Generate mixes for a single user
 * Calls the database function to handle the complex logic
 */
async function generateMixesForUser(supabase: any, userId: string, config: any): Promise<void> {
  // Call the database function to generate mixes
  const { data, error } = await supabase.rpc('generate_daily_mixes_for_user', {
    p_user_id: userId,
    p_config: config ? {
      enabled: config.enabled,
      mixes_per_user: config.mixes_per_user,
      tracks_per_mix: config.tracks_per_mix,
      familiar_ratio: config.familiar_ratio,
      min_play_duration_seconds: config.min_play_duration_seconds,
      skip_threshold_seconds: config.skip_threshold_seconds,
      refresh_hour: config.refresh_hour
    } : null
  });

  if (error) {
    console.error(`Error generating mixes for user ${userId}:`, error);
    throw error;
  }

  if (!data.success) {
    const errorMsg = data.error || 'Unknown error';
    // Don't throw for expected conditions like insufficient history
    if (errorMsg.includes('Insufficient listening history') || errorMsg.includes('already has fresh mixes')) {
      console.log(`Skipping user ${userId}: ${errorMsg}`);
      return;
    }
    throw new Error(errorMsg);
  }

  console.log(`Successfully generated ${data.mixes_created} mixes for user ${userId}`);
}
