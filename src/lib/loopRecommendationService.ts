import { supabase } from './supabase';

export interface LoopInteraction {
  user_id?: string | null;
  content_id: string;
  interaction_type: 'play' | 'like' | 'unlike' | 'comment' | 'share' | 'skip' | 'profile_visit' | 'rewatch' | 'complete';
  watch_duration?: number;
  video_duration?: number;
  completion_rate?: number;
  session_id?: string;
  metadata?: Record<string, any>;
}

export interface LoopRecommendation {
  content_id: string;
  recommendation_score: number;
  reason: string;
}

/**
 * Tracks a loop interaction (play, like, skip, etc.)
 */
export async function trackLoopInteraction(interaction: LoopInteraction): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    const interactionData = {
      ...interaction,
      user_id: user?.id || interaction.user_id,
      completion_rate: interaction.completion_rate || 0,
      watch_duration: interaction.watch_duration || 0,
      video_duration: interaction.video_duration || 0,
      metadata: interaction.metadata || {}
    };

    const { error } = await supabase
      .from('loop_interactions')
      .insert(interactionData);

    if (error) {
      console.error('Error tracking loop interaction:', error);
      return;
    }

    // Update interest graph if user is authenticated
    if (user?.id) {
      await updateUserInterestGraph(
        user.id,
        interaction.content_id,
        interaction.interaction_type,
        interaction.completion_rate || 0
      );
    }
  } catch (error) {
    console.error('Error in trackLoopInteraction:', error);
  }
}

/**
 * Updates user interest graph based on interaction
 */
export async function updateUserInterestGraph(
  userId: string,
  contentId: string,
  interactionType: string,
  completionRate: number = 0
): Promise<void> {
  try {
    const { error } = await supabase.rpc('update_user_interest_graph', {
      p_user_id: userId,
      p_content_id: contentId,
      p_interaction_type: interactionType,
      p_completion_rate: completionRate
    });

    if (error) {
      console.error('Error updating interest graph:', error);
    }
  } catch (error) {
    console.error('Error in updateUserInterestGraph:', error);
  }
}

/**
 * Gets personalized loop feed for a user
 */
export async function getSmartLoopFeed(
  userId: string | null,
  limit: number = 20,
  offset: number = 0
): Promise<LoopRecommendation[]> {
  try {
    if (!userId) {
      // Return trending content for anonymous users
      const { data, error } = await supabase
        .from('content_uploads')
        .select(`
          id,
          title,
          metadata
        `)
        .eq('content_type', 'short_clip')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(limit)
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return (data || []).map(item => ({
        content_id: item.id,
        recommendation_score: 50,
        reason: 'New content'
      }));
    }

    const { data, error } = await supabase.rpc('get_smart_loop_feed', {
      p_user_id: userId,
      p_limit: limit,
      p_offset: offset
    });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error getting smart loop feed:', error);
    return [];
  }
}

/**
 * Marks interaction as shown
 */
export async function markLoopAsShown(userId: string, contentId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('loop_recommendations')
      .update({ shown_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('content_id', contentId)
      .is('shown_at', null);

    if (error && error.code !== 'PGRST116') { // Ignore if no rows affected
      console.error('Error marking loop as shown:', error);
    }
  } catch (error) {
    console.error('Error in markLoopAsShown:', error);
  }
}

/**
 * Gets user watch history
 */
export async function getUserWatchHistory(userId: string, limit: number = 100): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('loop_interactions')
      .select('content_id')
      .eq('user_id', userId)
      .in('interaction_type', ['play', 'complete', 'skip'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return [...new Set((data || []).map(item => item.content_id))];
  } catch (error) {
    console.error('Error getting user watch history:', error);
    return [];
  }
}

/**
 * Calculates completion rate
 */
export function calculateCompletionRate(watchedSeconds: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0;
  return Math.min(Math.round((watchedSeconds / totalSeconds) * 100), 100);
}

/**
 * Generates a session ID for grouping interactions
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
