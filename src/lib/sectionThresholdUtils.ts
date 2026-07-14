import { supabase } from "@/lib/supabase";
import { isReleased } from "@/lib/releaseDateUtils";

export type SectionThresholdConfig = {
  min_play_count: number;
  min_like_count: number;
  time_window_days: number | null;
  is_enabled: boolean;
  use_fallback?: boolean;
};

const DEFAULT_CONFIG: SectionThresholdConfig = {
  min_play_count: 0,
  min_like_count: 0,
  time_window_days: null,
  is_enabled: true,
};

export type SectionThresholdConfigSource = "table" | "default";

export async function fetchSectionThresholdConfig(
  sectionKey: string
): Promise<SectionThresholdConfig & { source: SectionThresholdConfigSource }> {
  const { data, error } = await supabase
    .from("content_section_thresholds")
    .select("min_play_count, min_like_count, time_window_days, is_enabled, use_fallback")
    .eq("section_key", sectionKey)
    .maybeSingle();

  if (error) {
    console.warn(
      `[sectionThreshold] load ${sectionKey} failed — run docs/sql/content_section_thresholds_public_read.sql:`,
      error.message
    );
    return { ...DEFAULT_CONFIG, source: "default" };
  }

  if (!data) {
    console.warn(`[sectionThreshold] no row for section_key=${sectionKey}, using defaults`);
    return { ...DEFAULT_CONFIG, source: "default" };
  }

  const config = {
    min_play_count: data.min_play_count ?? 0,
    min_like_count: data.min_like_count ?? 0,
    time_window_days: data.time_window_days ?? null,
    is_enabled: data.is_enabled ?? true,
    use_fallback: data.use_fallback ?? undefined,
    source: "table" as const,
  };

  console.log(`[sectionThreshold] ${sectionKey} config from DB:`, {
    minPlays: config.min_play_count,
    minLikes: config.min_like_count,
    timeWindowDays: config.time_window_days,
    isEnabled: config.is_enabled,
  });

  return config;
}

export type ArtistMetrics = {
  metrics: Map<string, { plays: number; likes: number }>;
  /** False when we could not read the underlying tables (RLS/errors) — caller should fail open. */
  hasData: boolean;
};

/** Sum plays/likes per artist_id for threshold checks (batched, cache-friendly). */
export async function batchArtistPlayLikeMetrics(
  artistIds: string[],
  timeWindowDays: number | null
): Promise<ArtistMetrics> {
  const metrics = new Map<string, { plays: number; likes: number }>();
  for (const id of artistIds) metrics.set(id, { plays: 0, likes: 0 });
  if (artistIds.length === 0) return { metrics, hasData: true };

  const { data: songs, error: songsError } = await supabase
    .from("songs")
    .select("id, artist_id, play_count, release_date")
    .in("artist_id", artistIds)
    .not("audio_url", "is", null);

  if (songsError) {
    console.warn("[sectionThreshold] songs query failed (fail open):", songsError.message);
    return { metrics, hasData: false };
  }
  const publicSongs = (songs ?? []).filter((s) => isReleased(s.release_date));
  if (!publicSongs.length) {
    return { metrics, hasData: true };
  }

  const songToArtist = new Map<string, string>();
  for (const song of publicSongs) {
    songToArtist.set(song.id, song.artist_id);
  }

  const songIds = publicSongs.map((s) => s.id);
  const since =
    timeWindowDays != null
      ? new Date(Date.now() - timeWindowDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  if (!since) {
    for (const song of publicSongs) {
      const entry = metrics.get(song.artist_id);
      if (entry) entry.plays += song.play_count ?? 0;
    }
  } else {
    const { data: listens, error: listenError } = await supabase
      .from("listening_history")
      .select("song_id")
      .in("song_id", songIds)
      .gte("listened_at", since)
      .limit(10000);

    if (listenError) {
      console.warn(
        "[sectionThreshold] listening_history unavailable, using song play_count totals:",
        listenError.message
      );
      for (const song of publicSongs) {
        const entry = metrics.get(song.artist_id);
        if (entry) entry.plays += song.play_count ?? 0;
      }
    } else {
      for (const row of listens ?? []) {
        const artistId = songToArtist.get(row.song_id);
        if (artistId) metrics.get(artistId)!.plays += 1;
      }
    }
  }

  let likesQuery = supabase.from("user_favorites").select("song_id").in("song_id", songIds);
  if (since) {
    likesQuery = likesQuery.gte("created_at", since);
  }
  const { data: likes, error: likesError } = await likesQuery.limit(10000);

  if (likesError) {
    console.warn("[sectionThreshold] user_favorites query failed:", likesError.message);
  } else {
    for (const row of likes ?? []) {
      const artistId = songToArtist.get(row.song_id);
      if (artistId) metrics.get(artistId)!.likes += 1;
    }
  }

  return { metrics, hasData: true };
}

export async function meetsSectionThreshold(
  sectionKey: string,
  playCount: number,
  likeCount: number,
  config: SectionThresholdConfig
): Promise<boolean> {
  const attempts: Record<string, unknown>[] = [
    { section_key_param: sectionKey, play_count_param: playCount, like_count_param: likeCount },
    { section_key: sectionKey, play_count: playCount, like_count: likeCount },
  ];

  for (const params of attempts) {
    const { data, error } = await supabase.rpc("meets_section_threshold", params);
    if (!error && data !== null && data !== undefined) {
      return Boolean(data);
    }
  }

  console.warn("[sectionThreshold] meets_section_threshold RPC unavailable, using local check");

  return playCount >= config.min_play_count && likeCount >= config.min_like_count;
}

export type FeaturedRowForThreshold = {
  artist_id: string;
  auto_selected?: boolean | null;
  total_likes_last_week?: number | null;
};

/**
 * Featured Artistes home list:
 * - Manual rows (auto_selected === false): always show when active/in date.
 * - Auto rows (auto_selected === true): always show — eligibility was enforced by
 *   update_featured_artists_weekly in Supabase using Section Thresholds.
 * Re-filtering auto rows on the client often drops them (anon cannot read play/like tables).
 */
export async function filterFeaturedRowsByThreshold<T extends FeaturedRowForThreshold>(
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return [];

  const manual = rows.filter((r) => r.auto_selected === false);
  const autoSelected = rows.filter((r) => r.auto_selected === true);
  const legacy = rows.filter(
    (r) => r.auto_selected !== false && r.auto_selected !== true
  );

  console.log("[sectionThreshold] featured_artists home filter:", {
    manual: manual.length,
    autoSelected: autoSelected.length,
    legacy: legacy.length,
  });

  return [...manual, ...autoSelected, ...legacy];
}
