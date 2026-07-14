/*
  Admin RPC: aggregate ad_impressions by content_type and ad_type for a date range.

  Used by Ad Revenue overview to show impression volumes aligned with the same
  calendar window as AdMob daily totals (7d / 30d / 90d).
*/

CREATE OR REPLACE FUNCTION public.admin_aggregate_ad_impressions(
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_by_content jsonb;
  v_by_ad jsonb;
  v_total bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object(
      'by_content_type', '[]'::jsonb,
      'by_ad_type', '[]'::jsonb,
      'total_impressions', 0
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('content_type', g.ct, 'impressions', g.cnt)
      ORDER BY g.cnt DESC
    ),
    '[]'::jsonb
  )
  INTO v_by_content
  FROM (
    SELECT
      COALESCE(NULLIF(trim(lower(ai.content_type::text)), ''), 'unknown') AS ct,
      COUNT(*)::bigint AS cnt
    FROM public.ad_impressions ai
    WHERE ai.created_at::date >= p_start_date
      AND ai.created_at::date <= p_end_date
    GROUP BY 1
  ) g;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('ad_type', g.at, 'impressions', g.cnt)
      ORDER BY g.cnt DESC
    ),
    '[]'::jsonb
  )
  INTO v_by_ad
  FROM (
    SELECT
      COALESCE(NULLIF(trim(lower(ai.ad_type::text)), ''), 'unknown') AS at,
      COUNT(*)::bigint AS cnt
    FROM public.ad_impressions ai
    WHERE ai.created_at::date >= p_start_date
      AND ai.created_at::date <= p_end_date
    GROUP BY 1
  ) g;

  SELECT COUNT(*)::bigint
  INTO v_total
  FROM public.ad_impressions ai
  WHERE ai.created_at::date >= p_start_date
    AND ai.created_at::date <= p_end_date;

  RETURN jsonb_build_object(
    'by_content_type', v_by_content,
    'by_ad_type', v_by_ad,
    'total_impressions', COALESCE(v_total, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_aggregate_ad_impressions(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_aggregate_ad_impressions(date, date) TO authenticated;

COMMENT ON FUNCTION public.admin_aggregate_ad_impressions(date, date) IS
  'Admin-only: impression counts grouped by content_type and ad_type for calendar dates (created_at::date).';
