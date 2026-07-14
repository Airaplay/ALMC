import { WEB_ADMIN_PLACEMENT_KEYS } from "./webAdPlacementKeys";

export type WebAdPlacement =
  | "sidebar"
  | "banner_top"
  | "banner_bottom"
  | "in_feed"
  | "interstitial_web";

/** Web UI slots → `web_*` placement keys only (never native AdMob keys). */
export const WEB_PLACEMENT_KEY_MAP: Record<
  WebAdPlacement,
  { label: string; keys: string[] }
> = {
  sidebar: {
    label: "Sidebar / home rail",
    keys: ["web_home_screen_banner"],
  },
  banner_top: {
    label: "Mini player (above bottom bar)",
    keys: ["web_mini_music_player_top_banner"],
  },
  banner_bottom: {
    label: "Full player right rail (fallback order)",
    keys: [
      "web_music_player_bottom_banner",
      "web_album_player_bottom_banner",
      "web_playlist_player_bottom_banner",
      "web_daily_mix_player_bottom_banner",
    ],
  },
  in_feed: {
    label: "Home / explore / view-all in-feed",
    keys: ["web_home_screen_banner"],
  },
  interstitial_web: {
    label: "Web interstitial (overlay)",
    keys: ["web_before_song_play_interstitial", "web_before_video_play_interstitial"],
  },
};

/** Video watch page — web-only keys */
export const WEB_VIDEO_SIDEBAR_KEYS = [
  "web_video_player_bottom_banner",
  "web_loops_video_bottom_banner",
] as const;

export const WEB_RELEVANT_PLACEMENT_KEYS = [
  ...new Set([
    ...WEB_ADMIN_PLACEMENT_KEYS,
    ...Object.values(WEB_PLACEMENT_KEY_MAP).flatMap((m) => m.keys),
    ...WEB_VIDEO_SIDEBAR_KEYS,
  ]),
];
