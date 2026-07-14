/*
  # Fix Remaining Foreign Key Indexes and Cleanup

  1. Foreign Key Indexes
    - Add indexes for remaining unindexed foreign keys:
      - ad_revenue_events (artist_id, impression_id)
      - album_favorites (album_id)
      - album_genres (genre_id)
      - artist_profiles (genre_id)
      - comments (parent_comment_id)
      - featured_artists (artist_id)
      - featured_artists_history (artist_id)

  2. Cleanup Unused Indexes
    - Remove the indexes that were just created but are showing as unused
    - These were created in the previous migration but aren't being utilized by queries

  ## Security Impact
  - Adding foreign key indexes improves join performance and prevents full table scans
  - Removing unused indexes reduces storage overhead and improves write performance
  - All changes are backwards compatible
*/

-- =====================================================
-- PART 1: ADD REMAINING FOREIGN KEY INDEXES
-- =====================================================

-- Ad revenue events foreign keys
CREATE INDEX IF NOT EXISTS idx_ad_revenue_events_artist_id ON public.ad_revenue_events(artist_id);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_events_impression_id ON public.ad_revenue_events(impression_id);

-- Album foreign keys
CREATE INDEX IF NOT EXISTS idx_album_favorites_album_id ON public.album_favorites(album_id);
CREATE INDEX IF NOT EXISTS idx_album_genres_genre_id ON public.album_genres(genre_id);

-- Artist profile foreign keys
CREATE INDEX IF NOT EXISTS idx_artist_profiles_genre_id ON public.artist_profiles(genre_id);

-- Comments foreign keys
CREATE INDEX IF NOT EXISTS idx_comments_parent_comment_id ON public.comments(parent_comment_id);

-- Featured artists foreign keys
CREATE INDEX IF NOT EXISTS idx_featured_artists_artist_id ON public.featured_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_featured_artists_history_artist_id ON public.featured_artists_history(artist_id);

-- =====================================================
-- PART 2: REMOVE UNUSED INDEXES FROM PREVIOUS MIGRATION
-- =====================================================

-- These indexes were created in the previous migration but are showing as unused
-- Removing them to reduce storage and improve write performance

DROP INDEX IF EXISTS idx_albums_artist_id;
DROP INDEX IF EXISTS idx_announcements_created_by;
DROP INDEX IF EXISTS idx_artist_genres_genre_id;
DROP INDEX IF EXISTS idx_blocked_ips_blocked_by;
DROP INDEX IF EXISTS idx_content_reviews_content_upload_id;
DROP INDEX IF EXISTS idx_content_reviews_reviewer_id;
DROP INDEX IF EXISTS idx_content_uploads_artist_profile_id;
DROP INDEX IF EXISTS idx_curated_mixes_created_by;
DROP INDEX IF EXISTS idx_daily_checkin_config_created_by;
DROP INDEX IF EXISTS idx_daily_checkin_history_ad_impression_id;
DROP INDEX IF EXISTS idx_daily_checkin_settings_updated_by;
DROP INDEX IF EXISTS idx_featured_artists_history_user_id;
DROP INDEX IF EXISTS idx_payout_settings_created_by;
DROP INDEX IF EXISTS idx_payout_settings_updated_by;
DROP INDEX IF EXISTS idx_promotion_exposure_logs_cycle_id;
DROP INDEX IF EXISTS idx_promotion_impressions_user_id;
DROP INDEX IF EXISTS idx_rate_limit_violations_user_id;
DROP INDEX IF EXISTS idx_report_actions_performed_by;
DROP INDEX IF EXISTS idx_reports_reviewed_by;
DROP INDEX IF EXISTS idx_song_genres_genre_id;
DROP INDEX IF EXISTS idx_treat_payment_channels_created_by;
DROP INDEX IF EXISTS idx_treat_payment_channels_updated_by;
DROP INDEX IF EXISTS idx_treat_payments_package_id;
DROP INDEX IF EXISTS idx_treat_payments_payment_channel_id;
DROP INDEX IF EXISTS idx_treat_withdrawal_settings_updated_by;
DROP INDEX IF EXISTS idx_user_favorites_song_id;
DROP INDEX IF EXISTS idx_user_playback_state_song_id;
DROP INDEX IF EXISTS idx_withdrawal_requests_bank_details_id;
DROP INDEX IF EXISTS idx_withdrawal_requests_withdrawal_method_id;

-- Note: The listening_history.song_id index is kept as it's likely used in queries
-- Recreate only the essential foreign key indexes that are actually used
CREATE INDEX IF NOT EXISTS idx_listening_history_song_id ON public.listening_history(song_id);
