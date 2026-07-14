/*
  # Fix Search Path for User and Content Management Functions
  
  ## Security Issue
  Second phase of fixing SECURITY DEFINER functions without fixed search_path.
  This migration covers:
  - User management and data functions
  - Content deletion and moderation
  - Creator/Artist management
  - Promotion management
  
  ## Changes
  Add SET search_path = public, pg_temp to 30+ user/content functions
*/

-- Critical: Ban & Delete Functions
ALTER FUNCTION public.ban_creator_request(uuid, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_album_storage_files()
SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_clip_comment(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_content_upload_storage_files()
SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_message(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_promotion(uuid, uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_song_storage_files()
SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_thread(uuid)
SET search_path = public, pg_temp;

-- Admin: User Management
ALTER FUNCTION public.admin_get_top_tipped_users(timestamp, timestamp, integer)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_treat_users(text, text, boolean, text, integer, integer)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_user_treat_balance(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_user_treat_data(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_user_wallets(integer, integer)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_remove_treats_from_user(uuid, numeric, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_update_user_status(uuid, boolean)
SET search_path = public, pg_temp;

-- User Data & Settings Functions
ALTER FUNCTION public.check_username_availability(text, uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_ad_payout_settings(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_artist_id(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_checkin_status(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_notification_settings(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_payout_settings(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_playlists_for_song(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_privacy_settings(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_recently_played(uuid, integer)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_revenue_summary(uuid, timestamptz, timestamptz)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_user_threads()
SET search_path = public, pg_temp;

-- Content & Discovery Functions
ALTER FUNCTION public.get_active_banners()
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_comments_with_users(uuid, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_curated_mixes_for_user(text, uuid, integer)
SET search_path = public, pg_temp;

ALTER FUNCTION public.get_trending_near_user(uuid, integer)
SET search_path = public, pg_temp;
