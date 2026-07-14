import { useEffect, useState } from 'react';
import { isOfflineAvailable, subscribeOfflineDownloadsChanged } from '../lib/offlineAudioService';

/**
 * Tracks whether a song is present in the native offline download index (Android).
 */
export function useOfflineSong(songId: string | undefined | null): { isAvailable: boolean } {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    if (!songId) {
      setIsAvailable(false);
      return;
    }

    let cancelled = false;
    void isOfflineAvailable(songId).then((ok) => {
      if (!cancelled) setIsAvailable(ok);
    });

    const unsub = subscribeOfflineDownloadsChanged(() => {
      void isOfflineAvailable(songId).then((ok) => {
        if (!cancelled) setIsAvailable(ok);
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [songId]);

  return { isAvailable };
}
