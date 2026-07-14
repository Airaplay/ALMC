import { useEffect, useCallback, useRef } from 'react';
import { engagementSync, EngagementUpdate } from '../lib/engagementSyncService';

/**
 * Hook to sync engagement metrics (play counts, likes, etc.) in real-time
 * Usage in sections:
 *
 * const updateMetric = useEngagementSync((update) => {
 *   setSongs(prevSongs =>
 *     prevSongs.map(song =>
 *       song.id === update.contentId && update.metric === 'play_count'
 *         ? { ...song, play_count: update.value }
 *         : song
 *     )
 *   );
 * });
 */
export const useEngagementSync = (
  onUpdate: (update: EngagementUpdate) => void
): void => {
  const onUpdateRef = useRef(onUpdate);

  // Keep ref up to date
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    // Subscribe to all engagement updates
    const unsubscribe = engagementSync.subscribeToAll((update) => {
      onUpdateRef.current(update);
    });

    return () => {
      unsubscribe();
    };
  }, []);
};

/**
 * Hook to sync engagement metrics for a specific content item
 * Useful for detail screens or single-item components
 */
export const useContentEngagementSync = (
  contentId: string,
  onUpdate: (update: EngagementUpdate) => void
): void => {
  const onUpdateRef = useRef(onUpdate);

  // Keep ref up to date
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!contentId) return;

    // Subscribe to specific content updates
    const unsubscribe = engagementSync.subscribe(contentId, (update) => {
      onUpdateRef.current(update);
    });

    return () => {
      unsubscribe();
    };
  }, [contentId]);
};

/**
 * Hook to manually trigger engagement updates
 * Useful for like buttons, comment forms, etc.
 */
export const useEngagementEmitter = () => {
  const incrementPlayCount = useCallback((contentId: string, contentType: 'song' | 'video') => {
    engagementSync.incrementPlayCount(contentId, contentType);
  }, []);

  const updatePlayCount = useCallback((contentId: string, contentType: 'song' | 'video', count: number) => {
    engagementSync.updatePlayCount(contentId, contentType, count);
  }, []);

  const updateLikeCount = useCallback((contentId: string, contentType: 'song' | 'video' | 'album' | 'playlist', count: number) => {
    engagementSync.updateLikeCount(contentId, contentType, count);
  }, []);

  const updateViewCount = useCallback((contentId: string, contentType: 'song' | 'video', count: number) => {
    engagementSync.updateViewCount(contentId, contentType, count);
  }, []);

  const updateCommentCount = useCallback((contentId: string, contentType: 'song' | 'video', count: number) => {
    engagementSync.updateCommentCount(contentId, contentType, count);
  }, []);

  return {
    incrementPlayCount,
    updatePlayCount,
    updateLikeCount,
    updateViewCount,
    updateCommentCount
  };
};
