/**
 * Shared config for trending albums used by TrendingAlbumsSection and TrendingAlbumsViewAllScreen.
 * Keep in sync: both call get_trending_albums with these params so section and view-all show the same dataset.
 */
export const TRENDING_ALBUMS_RPC = {
  /** null = use admin-configured time_window_days in DB */
  daysParam: null as number | null,
  limitParam: 50,
} as const;
