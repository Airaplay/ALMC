import { supabase } from './supabase';
import { clearAdminLoginTrustStorage } from './adminEmailOtpGate';
import { cache } from './cache';
import { persistentCache } from './persistentCache';
import { smartCache } from './smartCache';

const AUTH_RELATED_KEYS = [
  'sb-',
  'supabase',
  'auth',
  'user',
  'session',
  'profile',
  'treat',
  'wallet',
  'playback',
  'favorites',
  'playlist',
  'recently-played',
  'listening-history',
  'home-screen',
  'artist-cache',
  'album-cache',
  'genre-cache',
  'mood-cache',
  'video-cache',
  'context-settings',
];

function clearLocalStorage(): void {
  try {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const shouldRemove = AUTH_RELATED_KEYS.some(pattern =>
          key.toLowerCase().includes(pattern.toLowerCase())
        );
        if (shouldRemove) {
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });

    console.log('[logoutService] Cleared localStorage items:', keysToRemove.length);
  } catch (error) {
    console.error('[logoutService] Error clearing localStorage:', error);
  }
}

function clearSessionStorage(): void {
  try {
    const keysToRemove: string[] = [];

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) {
        const shouldRemove = AUTH_RELATED_KEYS.some(pattern =>
          key.toLowerCase().includes(pattern.toLowerCase())
        );
        if (shouldRemove) {
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(key => {
      sessionStorage.removeItem(key);
    });

    console.log('[logoutService] Cleared sessionStorage items:', keysToRemove.length);
  } catch (error) {
    console.error('[logoutService] Error clearing sessionStorage:', error);
  }
}

async function clearAllCaches(): Promise<void> {
  try {
    cache.clear();
    console.log('[logoutService] Cleared in-memory cache');
  } catch (error) {
    console.error('[logoutService] Error clearing in-memory cache:', error);
  }

  try {
    await persistentCache.clear();
    console.log('[logoutService] Cleared persistent cache (IndexedDB)');
  } catch (error) {
    console.error('[logoutService] Error clearing persistent cache:', error);
  }

  try {
    await smartCache.clear();
    console.log('[logoutService] Cleared smart cache');
  } catch (error) {
    console.error('[logoutService] Error clearing smart cache:', error);
  }
}

async function clearIndexedDB(): Promise<void> {
  try {
    const databases = await indexedDB.databases?.() || [];

    for (const db of databases) {
      if (db.name && (
        db.name.includes('airaplay') ||
        db.name.includes('supabase') ||
        db.name.includes('cache')
      )) {
        indexedDB.deleteDatabase(db.name);
        console.log('[logoutService] Deleted IndexedDB database:', db.name);
      }
    }
  } catch (error) {
    console.debug('[logoutService] IndexedDB cleanup skipped (browser may not support databases())');
  }
}

export async function performCompleteLogout(): Promise<{ success: boolean; error?: string }> {
  console.log('[logoutService] Starting complete logout process...');

  try {
    clearAdminLoginTrustStorage();
    clearLocalStorage();
    clearSessionStorage();
    await clearAllCaches();
    await clearIndexedDB();

    const { error } = await supabase.auth.signOut({ scope: 'global' });

    if (error) {
      console.error('[logoutService] Supabase signOut error:', error);
      return { success: false, error: error.message };
    }

    console.log('[logoutService] Complete logout successful');
    return { success: true };
  } catch (error) {
    console.error('[logoutService] Logout failed:', error);

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (fallbackError) {
      console.error('[logoutService] Fallback signOut also failed:', fallbackError);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during logout'
    };
  }
}
