/**
 * Web-only `ad_placements.placement_key` values (prefix `web_`).
 * Native/Capacitor keeps keys like `music_player_bottom_banner` (AdMob).
 * Configure web rows in Admin → Ad Management → Placements.
 */
export const WEB_AD_PLACEMENT_KEYS = {
  /** Home main column — top */
  HOME_TOP: "web_home_screen_banner",
  /** Home feed between sections */
  HOME_IN_FEED: "web_home_screen_banner",
  /** Home xl right column */
  HOME_SIDEBAR: "web_home_screen_banner",
  /** Fixed bar above WebBottomPlayer */
  MINI_PLAYER_TOP: "web_mini_music_player_top_banner",
  /** WebMusicPlayerScreen right rail */
  MUSIC_PLAYER_BOTTOM: "web_music_player_bottom_banner",
  /** WebAlbumPlayerPage right rail */
  ALBUM_PLAYER_BOTTOM: "web_album_player_bottom_banner",
  /** WebPlaylistPlayerPage right rail */
  PLAYLIST_PLAYER_BOTTOM: "web_playlist_player_bottom_banner",
  /** WebDailyMixPlayerPage right rail */
  DAILY_MIX_PLAYER_BOTTOM: "web_daily_mix_player_bottom_banner",
  /** WebVideoPlayerPage — right column */
  VIDEO_PLAYER_SIDEBAR: "web_video_player_bottom_banner",
  /** View-all / discovery grids (in-feed card) */
  VIEW_ALL_IN_FEED: "web_home_screen_banner",
} as const;

export type WebAdminPlacementKey =
  (typeof WEB_AD_PLACEMENT_KEYS)[keyof typeof WEB_AD_PLACEMENT_KEYS];

/** All distinct web placement keys (for Admin Web Ads tab queries). */
export const WEB_ADMIN_PLACEMENT_KEYS = [
  ...new Set(Object.values(WEB_AD_PLACEMENT_KEYS)),
] as const;

/** Human-readable map for Admin → Web Ads tab */
export const WEB_AD_SURFACE_MAP: Array<{
  surface: string;
  routeOrContext: string;
  placementKey: WebAdminPlacementKey;
  component: string;
  /** Matching native key (AdMob) — for reference only */
  nativeKeyHint: string;
}> = [
  {
    surface: "Home — top banner",
    routeOrContext: "/",
    placementKey: WEB_AD_PLACEMENT_KEYS.HOME_TOP,
    component: "WebAdBanner (banner_top)",
    nativeKeyHint: "home_screen_banner",
  },
  {
    surface: "Home — between sections",
    routeOrContext: "/",
    placementKey: WEB_AD_PLACEMENT_KEYS.HOME_IN_FEED,
    component: "WebAdBanner (in_feed)",
    nativeKeyHint: "home_screen_banner",
  },
  {
    surface: "Home — bottom banner",
    routeOrContext: "/",
    placementKey: WEB_AD_PLACEMENT_KEYS.HOME_TOP,
    component: "WebAdBanner (banner_bottom)",
    nativeKeyHint: "home_screen_banner",
  },
  {
    surface: "Home — right sidebar (xl)",
    routeOrContext: "/",
    placementKey: WEB_AD_PLACEMENT_KEYS.HOME_SIDEBAR,
    component: "WebAdBanner (sidebar)",
    nativeKeyHint: "home_screen_banner",
  },
  {
    surface: "Mini player — right rail (in bar)",
    routeOrContext: "WebChromeLayout (md+; beside scrubber)",
    placementKey: WEB_AD_PLACEMENT_KEYS.MINI_PLAYER_TOP,
    component: "WebBottomPlayer",
    nativeKeyHint: "mini_music_player_top_banner",
  },
  {
    surface: "Full music player — right rail",
    routeOrContext: "/song/:id, overlay",
    placementKey: WEB_AD_PLACEMENT_KEYS.MUSIC_PLAYER_BOTTOM,
    component: "WebMusicPlayerScreen",
    nativeKeyHint: "music_player_bottom_banner",
  },
  {
    surface: "Album player — right rail",
    routeOrContext: "/album/:id/play",
    placementKey: WEB_AD_PLACEMENT_KEYS.ALBUM_PLAYER_BOTTOM,
    component: "WebAlbumPlayerPage",
    nativeKeyHint: "album_player_bottom_banner",
  },
  {
    surface: "Playlist player — right rail",
    routeOrContext: "/playlist/:id/play",
    placementKey: WEB_AD_PLACEMENT_KEYS.PLAYLIST_PLAYER_BOTTOM,
    component: "WebPlaylistPlayerPage",
    nativeKeyHint: "playlist_player_bottom_banner",
  },
  {
    surface: "Daily mix player — right rail",
    routeOrContext: "/daily-mix/:id",
    placementKey: WEB_AD_PLACEMENT_KEYS.DAILY_MIX_PLAYER_BOTTOM,
    component: "WebDailyMixPlayerPage",
    nativeKeyHint: "daily_mix_player_bottom_banner",
  },
  {
    surface: "Video player — sidebar",
    routeOrContext: "/video/:id",
    placementKey: WEB_AD_PLACEMENT_KEYS.VIDEO_PLAYER_SIDEBAR,
    component: "WebVideoPlayerPage",
    nativeKeyHint: "video_player_bottom_banner",
  },
  {
    surface: "View-all grids — in-feed card",
    routeOrContext: "/trending, /new-releases, …",
    placementKey: WEB_AD_PLACEMENT_KEYS.VIEW_ALL_IN_FEED,
    component: "WebInFeedAdSlot",
    nativeKeyHint: "home_screen_banner",
  },
  {
    surface: "View-all / mood — player right rail",
    routeOrContext: "immersive list players",
    placementKey: WEB_AD_PLACEMENT_KEYS.MUSIC_PLAYER_BOTTOM,
    component: "WebPlayerAdSlot",
    nativeKeyHint: "music_player_bottom_banner",
  },
  {
    surface: "Explore — after genres",
    routeOrContext: "/explore",
    placementKey: WEB_AD_PLACEMENT_KEYS.HOME_IN_FEED,
    component: "WebAdBanner (in_feed)",
    nativeKeyHint: "home_screen_banner",
  },
];
