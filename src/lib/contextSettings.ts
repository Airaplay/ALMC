import { supabase } from './supabase';

interface ContextSettings {
  shuffle_enabled: boolean;
  repeat_mode: 'off' | 'one' | 'all';
}

interface ContextSettingsCache {
  [contextKey: string]: ContextSettings;
}

const settingsCache: ContextSettingsCache = {};

const DEFAULT_SETTINGS: ContextSettings = {
  shuffle_enabled: false,
  repeat_mode: 'off'
};

export function generateContextKey(
  playlistContext: string,
  albumId: string | null
): string {
  if (albumId) {
    return `album-${albumId}`;
  }

  if (playlistContext.startsWith('playlist-')) {
    return playlistContext;
  }

  if (playlistContext.startsWith('album-')) {
    return playlistContext;
  }

  if (playlistContext.startsWith('mix-')) {
    return playlistContext;
  }

  if (playlistContext.startsWith('profile-')) {
    return playlistContext;
  }

  return `discovery-${playlistContext}`;
}

function getContextType(contextKey: string): string {
  if (contextKey.startsWith('album-')) return 'album';
  if (contextKey.startsWith('playlist-')) return 'playlist';
  if (contextKey.startsWith('mix-')) return 'playlist';
  if (contextKey.startsWith('profile-')) return 'profile';
  if (contextKey.startsWith('discovery-')) return 'discovery';
  if (contextKey.startsWith('song-')) return 'song';
  return 'discovery';
}

export async function loadContextSettings(
  contextKey: string
): Promise<ContextSettings> {
  if (settingsCache[contextKey]) {
    return settingsCache[contextKey];
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return DEFAULT_SETTINGS;
    }

    const { data, error } = await supabase
      .from('user_player_context_settings')
      .select('shuffle_enabled, repeat_mode')
      .eq('user_id', session.user.id)
      .eq('context_key', contextKey)
      .maybeSingle();

    if (error) {
      console.warn('Error loading context settings:', error);
      return DEFAULT_SETTINGS;
    }

    const settings = data || DEFAULT_SETTINGS;
    settingsCache[contextKey] = settings;
    return settings;
  } catch (error) {
    console.warn('Failed to load context settings:', error);
    return DEFAULT_SETTINGS;
  }
}

let saveTimeout: NodeJS.Timeout | null = null;

export async function saveContextSettings(
  contextKey: string,
  settings: ContextSettings
): Promise<void> {
  settingsCache[contextKey] = settings;

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const contextType = getContextType(contextKey);

      await supabase.rpc('upsert_context_settings', {
        p_user_id: session.user.id,
        p_context_key: contextKey,
        p_context_type: contextType,
        p_shuffle_enabled: settings.shuffle_enabled,
        p_repeat_mode: settings.repeat_mode
      });
    } catch (error) {
      console.warn('Failed to save context settings:', error);
    }
  }, 1000);
}

export function clearSettingsCache(): void {
  Object.keys(settingsCache).forEach(key => delete settingsCache[key]);
}
