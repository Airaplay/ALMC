import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

import { supabase } from './supabase';

export interface OfflineSongMeta {
  songId: string;
  title: string;
  artist: string;
  coverImageUrl?: string | null;
  durationSeconds?: number | null;
}

interface OfflineIndexEntry extends OfflineSongMeta {
  path: string;
  fileUri: string;
  webviewUrl: string;
  sourceUrl: string;
  sizeBytes: number;
  downloadedAt: string;
}

const OFFLINE_INDEX_KEY = 'offline_audio_index_v1';
const OFFLINE_DIR = 'offline-audio';
const OFFLINE_EVENT = 'offlineDownloadsChanged';

let indexCache: Record<string, OfflineIndexEntry> | null = null;
let indexLoadPromise: Promise<Record<string, OfflineIndexEntry>> | null = null;

function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

function dispatchChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
  } catch {
    // ignore
  }
}

async function ensureIndexLoaded(): Promise<Record<string, OfflineIndexEntry>> {
  if (indexCache) return indexCache;
  if (indexLoadPromise) return indexLoadPromise;
  indexLoadPromise = (async () => {
    try {
      const { value } = await Preferences.get({ key: OFFLINE_INDEX_KEY });
      const parsed = value ? (JSON.parse(value) as Record<string, OfflineIndexEntry>) : {};
      indexCache = parsed && typeof parsed === 'object' ? parsed : {};
      return indexCache;
    } catch {
      indexCache = {};
      return indexCache;
    } finally {
      indexLoadPromise = null;
    }
  })();
  return indexLoadPromise;
}

async function saveIndex(next: Record<string, OfflineIndexEntry>): Promise<void> {
  indexCache = next;
  await Preferences.set({ key: OFFLINE_INDEX_KEY, value: JSON.stringify(next) });
}

function inferExtension(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    const ext = dot !== -1 ? last.slice(dot + 1).toLowerCase() : '';
    if (!ext) return 'mp3';
    if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'].includes(ext)) return ext;
    return 'bin';
  } catch {
    return 'mp3';
  }
}

function parseEdgeFunctionError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      message?: string;
      name?: string;
      context?: { body?: unknown; message?: string } | Error | unknown;
    };

    // Network-layer failure (fetch never got a normal HTTP response).
    if (e.name === 'FunctionsFetchError') {
      const ctx = e.context;
      const inner =
        ctx instanceof Error
          ? ctx.message
          : ctx && typeof ctx === 'object' && 'message' in ctx && typeof (ctx as Error).message === 'string'
            ? (ctx as Error).message
            : '';
      const hint =
        'Deploy the Supabase Edge Function `offline-download-audio-url`, confirm the app uses the correct VITE_SUPABASE_URL, and check your network connection.';
      return inner ? `${inner}. ${hint}` : `Could not reach the download service. ${hint}`;
    }

    if (e.name === 'FunctionsRelayError') {
      return 'Supabase could not reach the Edge Function (relay error). Try again or check Supabase status and function deployment.';
    }

    const raw = e.context && typeof e.context === 'object' && 'body' in e.context ? (e.context as { body?: unknown }).body : undefined;
    if (raw != null) {
      try {
        const b = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (b && typeof b === 'object' && typeof (b as { error?: string }).error === 'string') {
          return (b as { error: string }).error;
        }
      } catch {
        // ignore
      }
    }
    if (e.message) return e.message;
  }
  return 'Download URL request failed';
}

async function fetchOfflineDownloadUrlFromEdge(songId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('offline-download-audio-url', {
    body: { song_id: songId },
  });
  if (error) {
    throw new Error(parseEdgeFunctionError(error));
  }
  const row = data as { url?: string; error?: string } | null;
  if (!row?.url || typeof row.url !== 'string') {
    throw new Error(typeof row?.error === 'string' ? row.error : 'Download URL unavailable');
  }
  return row.url;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function ensureOfflineDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ directory: Directory.Data, path: OFFLINE_DIR, recursive: true });
  } catch {
    // ignore if exists / not supported
  }
}

/** Use network + optional offline file URL for playback (Android native). */
export async function resolveSongForPlayback<T extends { id: string; audioUrl?: string | null }>(song: T): Promise<T> {
  if (!isAndroidNative() || !song.audioUrl) return song;
  try {
    const offline = await getOfflinePlaybackUrl(song.id);
    if (offline) return { ...song, audioUrl: offline };
  } catch {
    // keep network URL
  }
  return song;
}

export async function isOfflineAvailable(songId: string): Promise<boolean> {
  if (!isAndroidNative()) return false;
  const index = await ensureIndexLoaded();
  return !!index[songId];
}

export async function getOfflinePlaybackUrl(songId: string): Promise<string | null> {
  if (!isAndroidNative()) return null;
  const index = await ensureIndexLoaded();
  const entry = index[songId];
  if (!entry?.path) return null;

  try {
    await Filesystem.stat({ directory: Directory.Data, path: entry.path });
    if (entry.webviewUrl) return entry.webviewUrl;
    const uri = await Filesystem.getUri({ directory: Directory.Data, path: entry.path });
    const webviewUrl = Capacitor.convertFileSrc(uri.uri);
    const next = { ...index, [songId]: { ...entry, fileUri: uri.uri, webviewUrl } };
    try {
      await saveIndex(next);
    } catch {
      // ignore
    }
    return webviewUrl;
  } catch {
    const next = { ...index };
    delete next[songId];
    try {
      await saveIndex(next);
    } catch {
      // ignore
    }
    return null;
  }
}

export async function downloadOfflineSong(meta: OfflineSongMeta, audioUrl: string): Promise<void> {
  if (!isAndroidNative()) {
    throw new Error('Offline downloads are only supported on the Android app.');
  }
  if (!audioUrl?.startsWith('https://')) {
    throw new Error('Audio URL must be an https:// URL.');
  }

  const { fetchOfflineDownloadStatus } = await import('./offlineDownloadEntitlement');
  const entitlement = await fetchOfflineDownloadStatus();
  if (!entitlement.active) {
    throw new Error(
      'Offline downloads require an active Treat subscription. Confirm payment in the download dialog first.'
    );
  }

  await ensureOfflineDir();
  const index = await ensureIndexLoaded();

  const downloadUrl = await fetchOfflineDownloadUrlFromEdge(meta.songId);

  const res = await fetch(downloadUrl, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const buffer = await res.arrayBuffer();
  if (!buffer || buffer.byteLength < 1024) {
    throw new Error('Downloaded file is too small to be valid audio.');
  }

  const ext = inferExtension(downloadUrl);
  const filename = `${meta.songId}.${ext}`;
  const relPath = `${OFFLINE_DIR}/${filename}`;
  const base64 = arrayBufferToBase64(buffer);

  await Filesystem.writeFile({
    directory: Directory.Data,
    path: relPath,
    data: base64,
  });

  const uri = await Filesystem.getUri({ directory: Directory.Data, path: relPath });
  const webviewUrl = Capacitor.convertFileSrc(uri.uri);

  const next: Record<string, OfflineIndexEntry> = {
    ...index,
    [meta.songId]: {
      ...meta,
      path: relPath,
      fileUri: uri.uri,
      webviewUrl,
      sourceUrl: downloadUrl,
      sizeBytes: buffer.byteLength,
      downloadedAt: new Date().toISOString(),
    },
  };
  await saveIndex(next);
  dispatchChanged();
}

export async function deleteOfflineSong(songId: string): Promise<void> {
  if (!isAndroidNative()) return;
  const index = await ensureIndexLoaded();
  const entry = index[songId];
  if (!entry) return;

  try {
    await Filesystem.deleteFile({ directory: Directory.Data, path: entry.path });
  } catch {
    // ignore
  }

  const next = { ...index };
  delete next[songId];
  await saveIndex(next);
  dispatchChanged();
}

export async function listOfflineDownloads(): Promise<OfflineIndexEntry[]> {
  if (!isAndroidNative()) return [];
  const index = await ensureIndexLoaded();
  return Object.values(index).sort((a, b) => {
    const aTs = new Date(a.downloadedAt).getTime();
    const bTs = new Date(b.downloadedAt).getTime();
    return bTs - aTs;
  });
}

export function subscribeOfflineDownloadsChanged(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(OFFLINE_EVENT, handler as EventListener);
  return () => window.removeEventListener(OFFLINE_EVENT, handler as EventListener);
}

export function isOfflineDownloadPlatformSupported(): boolean {
  return isAndroidNative();
}
