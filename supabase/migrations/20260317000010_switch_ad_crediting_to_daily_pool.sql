/*
  # Switch Ad Crediting to Daily Pro‑Rata Pool (No Per‑Impression Crediting)

  IMPORTANT:
  - With pro‑rata pool distribution enabled, per‑impression crediting would DOUBLE‑PAY creators.
  - This migration changes `process_ad_impression_revenue` to:
    1) Create an auditable `ad_revenue_events` row
    2) NOT update users.total_earnings
    3) Mark the event as `pending_pool` (so admins can see it's awaiting daily distribution)

  Daily payout is performed by:
  - admin_distribute_creator_pool_for_date(date)
*/

CREATE OR REPLACE FUNCTION public.process_ad_impression_revenue(
  impression_uuid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  impression_record record;
  artist_record record;
  content_record record;
  revenue_amount numeric;
  artist_share_estimate numeric := 0;
  platform_share_estimate numeric := 0;
  payout_settings jsonb;
  new_revenue_id uuid;
  result jsonb;
BEGIN
  SELECT * INTO impression_record
  FROM public.ad_impressions
  WHERE id = impression_uuid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Ad impression not found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ad_revenue_events
    WHERE impression_id = impression_uuid
  ) THEN
    RETURN jsonb_build_object('error', 'Revenue already processed for this impression');
  END IF;

  -- Resolve artist_id from content (same attribution logic)
  IF impression_record.content_id IS NOT NULL THEN
    IF impression_record.content_type = 'song' THEN
      SELECT s.*, s.artist_id AS artist_id INTO content_record
      FROM public.songs s
      WHERE s.id = impression_record.content_id;

      IF FOUND AND content_record.artist_id IS NOT NULL THEN
        SELECT * INTO artist_record
        FROM public.artists
        WHERE id = content_record.artist_id;
      END IF;
    ELSE
      SELECT cu.*, ap.artist_id INTO content_record
      FROM public.content_uploads cu
      LEFT JOIN public.artist_profiles ap ON cu.artist_profile_id = ap.id
      WHERE cu.id = impression_record.content_id;

      IF FOUND AND content_record.artist_id IS NOT NULL THEN
        SELECT * INTO artist_record
        FROM public.artists
        WHERE id = content_record.artist_id;
      END IF;
    END IF;
  END IF;

  -- Keep revenue_amount for analytics (estimated), but do NOT credit per impression
  revenue_amount := public.calculate_ad_revenue(impression_uuid);

  payout_settings := public.get_user_ad_payout_settings(COALESCE(impression_record.user_id, NULL));

  IF artist_record.id IS NOT NULL THEN
    artist_share_estimate := revenue_amount * (payout_settings->>'artist_percentage')::numeric / 100;
  END IF;
  platform_share_estimate := revenue_amount - artist_share_estimate;

  INSERT INTO public.ad_revenue_events (
    impression_id,
    revenue_amount,
    currency,
    user_id,
    artist_id,
    content_id,
    status,
    metadata
  ) VALUES (
    impression_uuid,
    revenue_amount,
    'USD',
    impression_record.user_id,
    artist_record.id,
    impression_record.content_id,
    'pending',
    jsonb_build_object(
      'model', 'daily_pro_rata_pool',
      'note', 'No per-impression crediting. Daily pool distribution will credit creators.',
      'artist_share_estimate', artist_share_estimate,
      'platform_share_estimate', platform_share_estimate,
      'weight', public.compute_ad_impression_weight(impression_record.ad_type, impression_record.duration_viewed, impression_record.completed),
      'ad_type', impression_record.ad_type,
      'content_type', impression_record.content_type,
      'duration_viewed', impression_record.duration_viewed,
      'completed', impression_record.completed
    )
  )
  RETURNING id INTO new_revenue_id;

  result := jsonb_build_object(
    'success', true,
    'revenue_event_id', new_revenue_id,
    'revenue_amount_estimate', revenue_amount,
    'credited_to_users', false,
    'message', 'Impression recorded. Creator payout occurs in daily pro-rata distribution.'
  );

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.process_ad_impression_revenue(uuid) IS
  'Pool model: records an ad_revenue_events row for analytics/audit but does NOT credit users.total_earnings per impression. Use admin_distribute_creator_pool_for_date(date) to credit daily pro-rata payouts.';

