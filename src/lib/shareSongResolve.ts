import { supabase } from "@/lib/supabase";
import { resolveShareContentId } from "@/lib/shareLinkResolve";

/** Match WebMusicPlayerPage / server share gateway — avoid invalid nested columns. */
export const SONG_SHARE_SELECT = `
  id, title, cover_image_url, audio_url, duration_seconds, release_date, artist_id,
  artists:artist_id (
    id, name,
    artist_profiles ( user_id, stage_name )
  )
`;

const SONG_SHARE_SELECT_MINIMAL =
  "id, title, cover_image_url, audio_url, duration_seconds, release_date, artist_id";

export type ShareSongRow = {
  id: string;
  title: string;
  cover_image_url: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
  release_date?: string | null;
  artist_id?: string | null;
  artists: {
    id?: string;
    name?: string;
    artist_profiles?: { user_id?: string; stage_name?: string }[];
  } | null;
};

type UploadMetadata = {
  song_id?: string;
  audio_url?: string;
  file_url?: string;
  duration_seconds?: number;
};

function normalizeShareAudioUrl(url: string): string {
  return url
    .replace(/https?:\/\/uk\.storage\.bunnycdn\.com\/[^/]+\//i, "https://airaplay.b-cdn.net/")
    .replace(/https?:\/\/storage\.bunnycdn\.com\/[^/]+\//i, "https://airaplay.b-cdn.net/")
    .replace(/https?:\/\/[a-z0-9-]+\.bunnycdn\.com\//i, (match) =>
      match.includes("b-cdn.net") ? match : "https://airaplay.b-cdn.net/"
    );
}

function audioFromUploadMetadata(meta: unknown): string | null {
  const m = meta as UploadMetadata | null | undefined;
  const raw = m?.audio_url?.trim() || m?.file_url?.trim() || "";
  return raw || null;
}

async function fetchSongRowById(id: string): Promise<ShareSongRow | null> {
  const { data, error } = await supabase
    .from("songs")
    .select(SONG_SHARE_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!error && data) return data as ShareSongRow;

  const { data: minimal, error: minErr } = await supabase
    .from("songs")
    .select(SONG_SHARE_SELECT_MINIMAL)
    .eq("id", id)
    .maybeSingle();

  if (!minErr && minimal) {
    return { ...(minimal as ShareSongRow), artists: null };
  }

  return null;
}

/** Some catalog rows store playback URL only on the linked content_uploads metadata. */
async function enrichSongAudioFromUploads(
  song: ShareSongRow,
  legacyIds: string[]
): Promise<ShareSongRow> {
  if (song.audio_url?.trim()) {
    return { ...song, audio_url: normalizeShareAudioUrl(song.audio_url) };
  }

  const { data: bySong } = await supabase
    .from("content_uploads")
    .select("metadata")
    .eq("content_type", "single")
    .eq("status", "approved")
    .filter("metadata->>song_id", "eq", song.id)
    .limit(1)
    .maybeSingle();

  let raw = audioFromUploadMetadata(bySong?.metadata);

  if (!raw) {
    for (const legacyId of legacyIds) {
      if (legacyId === song.id) continue;
      const { data: byUpload } = await supabase
        .from("content_uploads")
        .select("metadata")
        .eq("id", legacyId)
        .eq("content_type", "single")
        .eq("status", "approved")
        .maybeSingle();
      raw = audioFromUploadMetadata(byUpload?.metadata);
      if (raw) break;
    }
  }

  const meta = (bySong?.metadata ?? null) as UploadMetadata | null;
  const duration =
    song.duration_seconds ?? (typeof meta?.duration_seconds === "number" ? meta.duration_seconds : null);

  if (!raw) {
    return { ...song, duration_seconds: duration };
  }

  return {
    ...song,
    audio_url: normalizeShareAudioUrl(raw),
    duration_seconds: duration,
  };
}

/** IDs to try when resolving a shared song link (songs.id, then content_uploads.metadata.song_id). */
export async function resolveCanonicalSongIdsForShare(rawId: string | null | undefined): Promise<string[]> {
  const primary = resolveShareContentId(rawId);
  if (!primary) return [];

  const ids: string[] = [primary];

  const { data: upload } = await supabase
    .from("content_uploads")
    .select("metadata")
    .eq("id", primary)
    .eq("content_type", "single")
    .eq("status", "approved")
    .maybeSingle();

  const meta = upload?.metadata as UploadMetadata | null | undefined;
  const linked = typeof meta?.song_id === "string" ? meta.song_id.trim() : "";
  if (linked && !ids.includes(linked)) ids.push(linked);

  return ids;
}

/** Load a song for share/deep-link routes; tolerates legacy links that used content_uploads.id. */
export async function fetchSongForShareLink(
  rawId: string | null | undefined
): Promise<{ song: ShareSongRow | null; canonicalId: string | null }> {
  const ids = await resolveCanonicalSongIdsForShare(rawId);
  if (!ids.length) return { song: null, canonicalId: null };

  for (const id of ids) {
    const row = await fetchSongRowById(id);
    if (row) {
      const song = await enrichSongAudioFromUploads(row, ids);
      return { song, canonicalId: song.id };
    }
  }

  return { song: null, canonicalId: ids[0] ?? null };
}

export function shareSongArtistName(song: ShareSongRow): string {
  const profile = song.artists?.artist_profiles?.[0];
  return profile?.stage_name || song.artists?.name || "Unknown Artiste";
}

/** Prefer songs.id when sharing library uploads (never share content_uploads.id). */
export async function resolveSongIdForSharing(
  metaSongId: string | null | undefined,
  uploadId: string
): Promise<string | null> {
  const fromMeta = String(metaSongId ?? "").trim();
  if (fromMeta) return fromMeta;

  const ids = await resolveCanonicalSongIdsForShare(uploadId);
  if (ids.length > 1) return ids[1];
  const { song } = await fetchSongForShareLink(uploadId);
  return song?.id ?? null;
}
