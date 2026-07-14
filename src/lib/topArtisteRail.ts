import { supabase } from "@/lib/supabase";
import { getPromotedContentDetailed } from "@/lib/promotionHelper";
import { persistentCache } from "@/lib/persistentCache";
import {
  fetchSectionThresholdConfig,
  filterFeaturedRowsByThreshold,
} from "@/lib/sectionThresholdUtils";

export interface TopArtisteRailArtist {
  id: string;
  artistId: string;
  userId: string;
  name: string;
  imageUrl: string | null;
  region: string;
  verified: boolean;
  weeklyGrowth: number;
  totalLikes: number;
  isFollowing?: boolean;
  isPromoted?: boolean;
}

const CACHE_KEY = "top_artiste_rail_v10";
const CACHE_TTL = 5 * 60 * 1000;
const THRESHOLD_SECTION_KEY = "featured_artists";
const FEATURED_ROW_LIMIT = 20;

export type TopArtisteRailState = {
  artists: TopArtisteRailArtist[];
  /** From Admin → Section Thresholds → Featured Artists → Enable section */
  sectionEnabled: boolean;
};

/** Admin FeaturedArtistsSection — base columns only (no embed; works when join RLS blocks anon). */
const FEATURED_BASE_SELECT =
  "id, artist_id, user_id, region, status, featured_start_date, featured_end_date, weekly_growth_percentage, total_likes_last_week, priority_order, auto_selected";

type FeaturedBaseRow = {
  id: string;
  artist_id: string;
  user_id: string | null;
  region: string;
  status?: string | null;
  featured_start_date?: string | null;
  featured_end_date?: string | null;
  weekly_growth_percentage?: number | null;
  total_likes_last_week?: number | null;
  auto_selected?: boolean | null;
};

type ArtistJoin = {
  id: string;
  name: string;
  image_url: string | null;
  verified?: boolean | null;
};

type ProfileJoin = {
  artist_id: string;
  user_id: string;
  stage_name?: string | null;
  profile_photo_url?: string | null;
};

type FeaturedRowWithArtist = FeaturedBaseRow & {
  artists?: ArtistJoin | null;
};

/** Date-only admin values are stored at UTC midnight; treat end date as inclusive through that calendar day. */
function dayStartMs(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).getTime();
}

function dayEndMs(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T23:59:59.999Z`).getTime();
}

/** In-window rows for home; scheduled counts once start day has begun. */
function isDisplayableFeaturedRow(row: FeaturedBaseRow): boolean {
  const status = (row.status ?? "active").toLowerCase();
  if (status === "expired") return false;

  const now = Date.now();
  if (status !== "active" && status !== "scheduled") return false;

  if (row.featured_start_date && dayStartMs(row.featured_start_date) > now) {
    return false;
  }
  if (row.featured_end_date && dayEndMs(row.featured_end_date) < now) {
    return false;
  }
  return true;
}

function pickDisplayableRows(all: FeaturedRowWithArtist[]): FeaturedRowWithArtist[] {
  const displayable = all.filter(isDisplayableFeaturedRow);
  if (displayable.length > 0) return displayable;

  const nonExpired = all.filter((r) => (r.status ?? "").toLowerCase() !== "expired");
  if (nonExpired.length > 0) {
    console.warn(
      "[TopArtisteRail] No in-window rows; showing non-expired admin rows. Set status=active and extend featured_end_date if needed.",
      { total: all.length, nonExpired: nonExpired.length }
    );
    return nonExpired;
  }
  return [];
}

/** Bypasses featured_artists RLS when direct SELECT returns [] for anon (docs/sql/get_featured_artists_for_home.sql). */
async function fetchFeaturedRowsViaRpc(): Promise<FeaturedRowWithArtist[] | null> {
  const { data, error } = await supabase.rpc("get_featured_artists_for_home", {
    p_limit: FEATURED_ROW_LIMIT,
  });

  if (error) {
    console.warn("[TopArtisteRail] get_featured_artists_for_home RPC failed:", error.message);
    return null;
  }

  if (!data?.length) return null;

  console.log("[TopArtisteRail] loaded via get_featured_artists_for_home RPC:", data.length);
  return data as FeaturedRowWithArtist[];
}

async function fetchFeaturedRowsWithJoin(): Promise<FeaturedRowWithArtist[] | null> {
  const { data, error } = await supabase
    .from("featured_artists")
    .select(`${FEATURED_BASE_SELECT}, artists:artist_id(id, name, image_url, verified)`)
    .not("status", "eq", "expired")
    .order("priority_order", { ascending: true })
    .limit(FEATURED_ROW_LIMIT);

  if (error) {
    console.warn("[TopArtisteRail] featured_artists join query failed:", error.message);
    return null;
  }
  return (data ?? []) as FeaturedRowWithArtist[];
}

async function fetchFeaturedRowsBase(): Promise<FeaturedRowWithArtist[]> {
  const { data, error } = await supabase
    .from("featured_artists")
    .select(FEATURED_BASE_SELECT)
    .order("priority_order", { ascending: true })
    .limit(FEATURED_ROW_LIMIT);

  if (error) {
    console.error("[TopArtisteRail] featured_artists (base) failed:", error.message, error);
    throw error;
  }
  return (data ?? []) as FeaturedRowWithArtist[];
}

async function fetchFeaturedBaseRows(
  thresholdConfig: Awaited<ReturnType<typeof fetchSectionThresholdConfig>>
): Promise<FeaturedRowWithArtist[]> {
  const rpcRows = await fetchFeaturedRowsViaRpc();
  let all: FeaturedRowWithArtist[] = rpcRows ?? [];
  let source: "rpc" | "join" | "base" = rpcRows && rpcRows.length > 0 ? "rpc" : "base";

  if (all.length === 0) {
    const joined = await fetchFeaturedRowsWithJoin();
    all = joined ?? [];
    source = joined && joined.length > 0 ? "join" : "base";
  }
  if (all.length === 0) {
    all = await fetchFeaturedRowsBase();
    source = "base";
  }
  const picked = pickDisplayableRows(all);
  const afterThreshold = await filterFeaturedRowsByThreshold(picked);

  console.log("[TopArtisteRail] featured_artists rows:", {
    source,
    total: all.length,
    displayable: picked.length,
    afterThreshold: afterThreshold.length,
    threshold: {
      source: thresholdConfig.source,
      minPlays: thresholdConfig.min_play_count,
      minLikes: thresholdConfig.min_like_count,
      timeWindowDays: thresholdConfig.time_window_days,
      isEnabled: thresholdConfig.is_enabled,
    },
    statuses: all.map((r) => r.status),
  });

  if (all.length === 0) {
    console.warn(
      "[TopArtisteRail] Zero rows from featured_artists — run docs/sql/featured_artists_public_read.sql in Supabase SQL Editor."
    );
  }

  return afterThreshold;
}

async function loadArtistMetaByArtistIds(artistIds: string[]): Promise<{
  artists: Map<string, ArtistJoin>;
  profiles: Map<string, ProfileJoin>;
}> {
  const artists = new Map<string, ArtistJoin>();
  const profiles = new Map<string, ProfileJoin>();

  if (artistIds.length === 0) return { artists, profiles };

  const [{ data: artistRows, error: artistError }, { data: profileRows, error: profileError }] =
    await Promise.all([
      supabase.from("artists").select("id, name, image_url, verified").in("id", artistIds),
      supabase
        .from("artist_profiles")
        .select("artist_id, user_id, stage_name, profile_photo_url")
        .in("artist_id", artistIds),
    ]);

  if (artistError) {
    console.warn("[TopArtisteRail] artists batch failed:", artistError.message);
  } else {
    (artistRows ?? []).forEach((a) => artists.set(a.id, a as ArtistJoin));
  }

  if (profileError) {
    console.warn("[TopArtisteRail] artist_profiles batch failed:", profileError.message);
  } else {
    (profileRows ?? []).forEach((p) => {
      if (p.artist_id && p.user_id) profiles.set(p.artist_id, p as ProfileJoin);
    });
  }

  return { artists, profiles };
}

function baseRowsToRailArtists(
  rows: FeaturedRowWithArtist[],
  artists: Map<string, ArtistJoin>,
  profiles: Map<string, ProfileJoin>,
  followingStatus: Set<string>,
  promotedUserIds: Set<string>,
  promotedArtistIds: Set<string>
): TopArtisteRailArtist[] {
  const result: TopArtisteRailArtist[] = [];

  for (const row of rows) {
    if (!row.artist_id) continue;

    const profile = profiles.get(row.artist_id);
    const artist = row.artists ?? artists.get(row.artist_id);
    const userId = row.user_id || profile?.user_id;
    if (!userId) {
      console.warn("[TopArtisteRail] skip row missing user_id:", row.id, row.artist_id);
      continue;
    }

    const name =
      profile?.stage_name?.trim() ||
      artist?.name?.trim() ||
      "Unknown Artiste";
    const imageUrl =
      artist?.image_url ??
      profile?.profile_photo_url ??
      null;

    result.push({
      id: row.id,
      artistId: row.artist_id,
      userId,
      name,
      imageUrl,
      region: row.region || "global",
      verified: artist?.verified ?? false,
      weeklyGrowth: row.weekly_growth_percentage ?? 0,
      totalLikes: row.total_likes_last_week ?? 0,
      isFollowing: followingStatus.has(userId),
      isPromoted:
        promotedUserIds.has(userId) ||
        promotedArtistIds.has(row.artist_id) ||
        promotedArtistIds.has(userId),
    });
  }

  return result;
}

async function fetchFollowingSet(
  followerId: string,
  followingIds: string[]
): Promise<Set<string>> {
  if (followingIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", followerId)
    .in("following_id", followingIds);

  if (error) {
    console.warn("[TopArtisteRail] follow status failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((f) => f.following_id));
}

function sortByRegion(rows: FeaturedRowWithArtist[], region: string): FeaturedRowWithArtist[] {
  const regional = rows.filter((r) => r.region === region);
  const global = rows.filter((r) => r.region === "global");
  const other = rows.filter((r) => r.region !== region && r.region !== "global");
  const sorted = [...regional, ...global, ...other];

  const seen = new Set<string>();
  return sorted.filter((r) => {
    if (seen.has(r.artist_id)) return false;
    seen.add(r.artist_id);
    return true;
  });
}

async function buildTopArtisteRail(
  sessionUserId: string | null
): Promise<TopArtisteRailState> {
  const thresholdConfig = await fetchSectionThresholdConfig(THRESHOLD_SECTION_KEY);
  if (!thresholdConfig.is_enabled) {
    console.log("[TopArtisteRail] section disabled in content_section_thresholds");
    return { artists: [], sectionEnabled: false };
  }

  let region = "global";
  if (sessionUserId) {
    const { data: userData } = await supabase
      .from("users")
      .select("country")
      .eq("id", sessionUserId)
      .maybeSingle();
    if (userData?.country) region = userData.country;
  }

  const [baseRows, promotedItems] = await Promise.all([
    fetchFeaturedBaseRows(thresholdConfig),
    getPromotedContentDetailed("top_artist", "profile", 10, sessionUserId).catch((err) => {
      console.warn("[TopArtisteRail] promotions failed:", err);
      return [];
    }),
  ]);

  const promotedUserIds = new Set(
    promotedItems.map((p) => p.userId || p.targetId).filter(Boolean)
  );
  const promotedArtistIds = new Set(promotedItems.map((p) => p.targetId).filter(Boolean));

  if (baseRows.length === 0) {
    console.warn(
      "[TopArtisteRail] No displayable rows — check RLS (docs/sql/featured_artists_public_read.sql), status=active, and date window."
    );
    return { artists: [], sectionEnabled: true };
  }

  const sorted = sortByRegion(baseRows, region);
  const needsMeta =
    sorted.some((r) => !r.artists) || sorted.some((r) => !r.user_id);
  const artistIds = sorted.map((r) => r.artist_id).filter(Boolean);
  const { artists, profiles } = needsMeta
    ? await loadArtistMetaByArtistIds(artistIds)
    : { artists: new Map<string, ArtistJoin>(), profiles: new Map<string, ProfileJoin>() };

  if (needsMeta && artistIds.length > 0 && artists.size === 0 && profiles.size === 0) {
    console.warn(
      "[TopArtisteRail] Could not load artists/artist_profiles for anon — ensure public SELECT on those tables."
    );
  }

  const userIds = sorted
    .map((r) => r.user_id || profiles.get(r.artist_id)?.user_id)
    .filter((id): id is string => Boolean(id));

  const followingStatus = sessionUserId
    ? await fetchFollowingSet(sessionUserId, userIds)
    : new Set<string>();

  const rail = baseRowsToRailArtists(
    sorted,
    artists,
    profiles,
    followingStatus,
    promotedUserIds,
    promotedArtistIds
  );

  console.log("[TopArtisteRail] built", {
    baseRows: baseRows.length,
    sorted: sorted.length,
    artistsFound: artists.size,
    profilesFound: profiles.size,
    rail: rail.length,
  });

  return { artists: rail.slice(0, 10), sectionEnabled: true };
}

/**
 * Featured Artistes for home (same `featured_artists` table as Admin → Featured Artistes).
 */
export async function fetchTopArtisteRailState(
  userIdOptional?: string | null
): Promise<TopArtisteRailState> {
  const { data: sessionData } = await supabase.auth.getSession();
  const sessionUserId = userIdOptional ?? sessionData.session?.user?.id ?? null;
  const cacheKey = `${CACHE_KEY}:${sessionUserId ?? "anon"}`;

  const cached = await persistentCache.get<TopArtisteRailState>(cacheKey);
  if (cached) {
    if (!cached.sectionEnabled || cached.artists.length > 0) {
      return cached;
    }
  }

  const final = await buildTopArtisteRail(sessionUserId);

  if (!final.sectionEnabled || final.artists.length > 0) {
    void persistentCache.set(cacheKey, final, CACHE_TTL);
  }

  return final;
}

/** @deprecated Prefer fetchTopArtisteRailState for sectionEnabled. */
export async function fetchTopArtisteRail(
  userIdOptional?: string | null
): Promise<TopArtisteRailArtist[]> {
  const { artists } = await fetchTopArtisteRailState(userIdOptional);
  return artists;
}

/** Bust stale empty caches after deploy. */
export function invalidateTopArtisteRailCache(userId?: string | null): void {
  const key = `${CACHE_KEY}:${userId ?? "anon"}`;
  void persistentCache.delete(key);
}
