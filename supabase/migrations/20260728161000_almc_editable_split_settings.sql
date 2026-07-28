/*
  # ALMC editable revenue split settings

  - Org-level default split stored in `public.organizations.settings` as:
      organizations.settings->>'almc_org_split_org_pct' (org share %)
  - Per-artist override stored on `public.organization_artist_links.org_split_pct_override`
  - Read-only Revenue rollup now uses:
      effective_org_split_pct = COALESCE(oal.org_split_pct_override, org_default_org_split_pct)
*/

-- ---------------------------------------------------------------------------
-- Schema: per-artist override
-- ---------------------------------------------------------------------------
ALTER TABLE public.organization_artist_links
  ADD COLUMN IF NOT EXISTS org_split_pct_override numeric;

-- ---------------------------------------------------------------------------
-- Org-level split RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.almc_get_org_split_settings(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_split numeric;
  v_artist_split numeric;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT (
    public.org_member_has_permission(p_org_id, 'analytics.view', v_user_id)
    OR public.org_member_has_permission(p_org_id, 'org.manage', v_user_id)
    OR public.org_member_has_permission(p_org_id, 'org.settings', v_user_id)
  ) THEN
    RAISE EXCEPTION 'Missing permission';
  END IF;

  SELECT
    COALESCE((o.settings->>'almc_org_split_org_pct')::numeric, 0)
  INTO v_org_split
  FROM public.organizations o
  WHERE o.id = p_org_id;

  v_org_split := GREATEST(LEAST(COALESCE(v_org_split, 0), 100), 0);
  v_artist_split := 100 - v_org_split;

  RETURN jsonb_build_object(
    'org_split_pct', v_org_split,
    'artist_split_pct', v_artist_split
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.almc_get_org_split_settings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.almc_set_org_split_settings(
  p_org_id uuid,
  p_org_split_pct numeric
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_split numeric;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT (
    public.org_member_has_permission(p_org_id, 'org.manage', v_user_id)
    OR public.org_member_has_permission(p_org_id, 'org.settings', v_user_id)
  ) THEN
    RAISE EXCEPTION 'Missing permission';
  END IF;

  v_org_split := GREATEST(LEAST(COALESCE(p_org_split_pct, 0), 100), 0);

  UPDATE public.organizations o
  SET settings = jsonb_set(
    o.settings,
    '{almc_org_split_org_pct}',
    to_jsonb(v_org_split),
    true
  )
  WHERE o.id = p_org_id;

  RETURN jsonb_build_object('success', true, 'org_split_pct', v_org_split, 'artist_split_pct', 100 - v_org_split);
END;
$$;

GRANT EXECUTE ON FUNCTION public.almc_set_org_split_settings(uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- Per-artist override RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.almc_set_artist_split_override(
  p_org_id uuid,
  p_artist_profile_id uuid,
  p_org_split_pct_override numeric
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_override numeric;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT (
    public.org_member_has_permission(p_org_id, 'org.manage', v_user_id)
    OR public.org_member_has_permission(p_org_id, 'org.settings', v_user_id)
  ) THEN
    RAISE EXCEPTION 'Missing permission';
  END IF;

  IF p_org_split_pct_override IS NULL THEN
    v_override := NULL;
  ELSE
    v_override := GREATEST(LEAST(COALESCE(p_org_split_pct_override, 0), 100), 0);
  END IF;

  UPDATE public.organization_artist_links oal
  SET org_split_pct_override = v_override,
      updated_at = now()
  WHERE oal.organization_id = p_org_id
    AND oal.artist_profile_id = p_artist_profile_id
    AND oal.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artist link not found or not active';
  END IF;

  RETURN jsonb_build_object('success', true, 'org_split_pct_override', v_override);
END;
$$;

GRANT EXECUTE ON FUNCTION public.almc_set_artist_split_override(uuid, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.almc_get_artist_split_settings(
  p_org_id uuid,
  p_artist_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_default_org_split numeric := 0;
  v_override numeric;
  v_org_split numeric;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT (
    public.org_member_has_permission(p_org_id, 'artists.view', v_user_id)
    OR public.org_member_has_permission(p_org_id, 'org.manage', v_user_id)
    OR public.org_member_has_permission(p_org_id, 'org.settings', v_user_id)
  ) THEN
    RAISE EXCEPTION 'Missing permission';
  END IF;

  SELECT COALESCE((o.settings->>'almc_org_split_org_pct')::numeric, 0)
  INTO v_default_org_split
  FROM public.organizations o
  WHERE o.id = p_org_id;

  SELECT oal.org_split_pct_override
  INTO v_override
  FROM public.organization_artist_links oal
  WHERE oal.organization_id = p_org_id
    AND oal.artist_profile_id = p_artist_profile_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artist link not found';
  END IF;

  v_org_split := COALESCE(v_override, v_default_org_split);
  v_org_split := GREATEST(LEAST(COALESCE(v_org_split, 0), 100), 0);

  RETURN jsonb_build_object(
    'org_split_pct_override', v_override,
    'org_split_pct', v_org_split,
    'artist_split_pct', 100 - v_org_split
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.almc_get_artist_split_settings(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_organization_artists(
  p_org_id uuid,
  p_search text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_genre text DEFAULT NULL,
  p_verified text DEFAULT 'all',
  p_sort text DEFAULT 'streams'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_items jsonb;
  v_total int;
  v_sort text := lower(COALESCE(p_sort, 'streams'));
  v_default_org_split_pct numeric := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'artists.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing artists.view permission';
  END IF;

  SELECT COALESCE((o.settings->>'almc_org_split_org_pct')::numeric, 0)
  INTO v_default_org_split_pct
  FROM public.organizations o
  WHERE o.id = p_org_id;

  v_default_org_split_pct := GREATEST(LEAST(COALESCE(v_default_org_split_pct, 0), 100), 0);

  IF v_sort NOT IN ('streams', 'monthly_streams', 'followers', 'revenue', 'stage_name', 'linked_at') THEN
    v_sort := 'streams';
  END IF;

  WITH combined AS (
    SELECT
      oal.id AS link_id,
      oal.status AS link_status,
      oal.linked_at,
      false AS is_pending_invitation,
      NULL::uuid AS invitation_id,
      NULL::text AS invitation_type,
      ap.id AS artist_profile_id,
      ap.stage_name,
      ap.profile_photo_url,
      ap.is_verified,
      ap.country,
      ap.artist_id,
      u.id AS user_id,
      u.email,
      u.display_name,
      COALESCE(g.name, '') AS genre,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.user_follows uf
        WHERE uf.following_id = u.id
      ), 0) AS followers,
      (
        COALESCE((
          SELECT SUM(s.play_count)::bigint
          FROM public.artists a
          LEFT JOIN public.songs s ON s.artist_id = a.id
          WHERE a.id = ap.artist_id
        ), 0)
        + COALESCE((
          SELECT SUM(cu.play_count)::bigint
          FROM public.content_uploads cu
          WHERE cu.user_id = u.id
        ), 0)
      ) AS streams,
      (
        COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          WHERE lh.listened_at >= now() - interval '30 days'
            AND (
              lh.song_id IN (
                SELECT s.id
                FROM public.songs s
                WHERE s.artist_id = ap.artist_id
              )
              OR lh.content_upload_id IN (
                SELECT cu.id
                FROM public.content_uploads cu
                WHERE cu.user_id = u.id
              )
            )
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.video_playback_history vph
          WHERE vph.watched_at >= now() - interval '30 days'
            AND vph.content_id IN (
              SELECT cu.id
              FROM public.content_uploads cu
              WHERE cu.user_id = u.id
            )
        ), 0)
      ) AS monthly_streams,
      COALESCE(u.total_earnings, 0)::numeric AS revenue,
      oal.org_split_pct_override,
      COALESCE(oal.org_split_pct_override, v_default_org_split_pct) AS org_split_pct,
      100 - COALESCE(oal.org_split_pct_override, v_default_org_split_pct) AS artist_split_pct,
      (
        SELECT jsonb_build_object(
          'title', latest.title,
          'type', latest.content_type,
          'created_at', latest.created_at
        )
        FROM (
          SELECT s.title, 'single'::text AS content_type, s.created_at
          FROM public.artists a
          JOIN public.songs s ON s.artist_id = a.id
          WHERE a.id = ap.artist_id
          UNION ALL
          SELECT cu.title, cu.content_type, cu.created_at
          FROM public.content_uploads cu
          WHERE cu.user_id = u.id
        ) latest
        ORDER BY latest.created_at DESC NULLS LAST
        LIMIT 1
      ) AS latest_release
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    JOIN public.users u ON u.id = oal.user_id
    LEFT JOIN public.genres g ON g.id = ap.genre_id
    WHERE oal.organization_id = p_org_id
      AND (p_status = 'all' OR oal.status = p_status)
      AND (
        p_search IS NULL OR trim(p_search) = ''
        OR ap.stage_name ILIKE '%' || trim(p_search) || '%'
        OR u.email ILIKE '%' || trim(p_search) || '%'
        OR u.display_name ILIKE '%' || trim(p_search) || '%'
      )

    UNION ALL

    SELECT
      oai.id AS link_id,
      'pending_invite'::text AS link_status,
      NULL::timestamptz AS linked_at,
      true AS is_pending_invitation,
      oai.id AS invitation_id,
      oai.invitation_type,
      oai.artist_profile_id,
      COALESCE(
        ap.stage_name,
        NULLIF(trim(oai.artist_metadata->>'stage_name'), ''),
        split_part(oai.invitee_email, '@', 1)
      ) AS stage_name,
      ap.profile_photo_url,
      ap.is_verified,
      COALESCE(ap.country, NULLIF(trim(oai.artist_metadata->>'country'), '')) AS country,
      ap.artist_id,
      oai.invitee_user_id AS user_id,
      oai.invitee_email AS email,
      u.display_name,
      COALESCE(g.name, NULLIF(trim(oai.artist_metadata->>'genre'), ''), '') AS genre,
      0::bigint AS followers,
      0::bigint AS streams,
      0::bigint AS monthly_streams,
      0::numeric AS revenue,
      NULL::numeric AS org_split_pct_override,
      v_default_org_split_pct AS org_split_pct,
      (100 - v_default_org_split_pct)::numeric AS artist_split_pct,
      NULL::jsonb AS latest_release
    FROM public.organization_artist_invitations oai
    LEFT JOIN public.artist_profiles ap ON ap.id = oai.artist_profile_id
    LEFT JOIN public.users u ON u.id = oai.invitee_user_id
    LEFT JOIN public.genres g ON g.id = ap.genre_id
    WHERE oai.organization_id = p_org_id
      AND oai.status = 'pending'
      AND oai.expires_at > now()
      AND (p_status = 'all' OR p_status = 'pending_invite')
      AND NOT EXISTS (
        SELECT 1
        FROM public.organization_artist_links oal2
        WHERE oal2.organization_id = p_org_id
          AND (
            (oai.artist_profile_id IS NOT NULL AND oal2.artist_profile_id = oai.artist_profile_id)
            OR (oai.invitee_user_id IS NOT NULL AND oal2.user_id = oai.invitee_user_id)
          )
          AND oal2.status IN ('active', 'pending_invite')
      )
      AND (
        p_search IS NULL OR trim(p_search) = ''
        OR COALESCE(ap.stage_name, oai.artist_metadata->>'stage_name', oai.invitee_email)
          ILIKE '%' || trim(p_search) || '%'
        OR oai.invitee_email ILIKE '%' || trim(p_search) || '%'
        OR u.display_name ILIKE '%' || trim(p_search) || '%'
      )
  ),
  filtered AS (
    SELECT *
    FROM combined
    WHERE (
      COALESCE(p_verified, 'all') = 'all'
      OR (p_verified = 'verified' AND COALESCE(is_verified, false) = true)
      OR (p_verified = 'unverified' AND COALESCE(is_verified, false) = false)
    )
    AND (
      p_genre IS NULL OR trim(p_genre) = ''
      OR COALESCE(genre, '') ILIKE '%' || trim(p_genre) || '%'
    )
  ),
  totals AS (
    SELECT COUNT(*)::int AS total FROM filtered
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN v_sort = 'stage_name' THEN stage_name END ASC NULLS LAST,
      CASE WHEN v_sort = 'linked_at' THEN linked_at END DESC NULLS LAST,
      CASE WHEN v_sort = 'followers' THEN followers END DESC NULLS LAST,
      CASE WHEN v_sort = 'revenue' THEN revenue END DESC NULLS LAST,
      CASE WHEN v_sort = 'monthly_streams' THEN monthly_streams END DESC NULLS LAST,
      CASE WHEN v_sort = 'streams' THEN streams END DESC NULLS LAST,
      streams DESC NULLS LAST,
      stage_name ASC NULLS LAST
    LIMIT GREATEST(p_limit, 1)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT
    totals.total,
    COALESCE(
      (SELECT jsonb_agg(row_to_json(paged_row)::jsonb)
       FROM paged AS paged_row),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM totals;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_organization_artists(uuid, text, text, int, int, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Revenue rollup: include org share vs artist share breakdown
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_organization_revenue(
  p_org_id uuid,
  p_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_days int := GREATEST(LEAST(COALESCE(p_days, 30), 365), 1);
  v_period_end date := CURRENT_DATE;
  v_period_start date := v_period_end - v_days;

  v_default_org_split_pct numeric := 0;
  v_default_artist_split_pct numeric := 100;

  v_gross_total numeric := 0;
  v_org_share_total numeric := 0;
  v_artist_share_total numeric := 0;

  v_period numeric := 0;
  v_pending numeric := 0;
  v_by_artist jsonb := '[]'::jsonb;
  v_monthly jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT (
    public.org_member_has_permission(p_org_id, 'analytics.view', v_user_id)
    OR public.org_member_has_permission(p_org_id, 'org.manage', v_user_id)
  ) THEN
    RAISE EXCEPTION 'Missing revenue view permission';
  END IF;

  SELECT
    COALESCE((o.settings->>'almc_org_split_org_pct')::numeric, 0)
  INTO v_default_org_split_pct
  FROM public.organizations o
  WHERE o.id = p_org_id;

  v_default_org_split_pct := GREATEST(LEAST(COALESCE(v_default_org_split_pct, 0), 100), 0);
  v_default_artist_split_pct := 100 - v_default_org_split_pct;

  -- Total gross earnings across linked artists
  SELECT COALESCE(SUM(u.total_earnings), 0)
  INTO v_gross_total
  FROM public.organization_artist_links oal
  JOIN public.users u ON u.id = oal.user_id
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  -- Period ads payout (kept as gross; UI focuses on total earnings breakdown)
  SELECT COALESCE(SUM(acdp.payout_usd), 0)
  INTO v_period
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_period_start
    AND acdp.revenue_date <= v_period_end;

  -- Pending treats balance across linked artists
  SELECT COALESCE(SUM(tw.pending_balance), 0)
  INTO v_pending
  FROM public.organization_artist_links oal
  LEFT JOIN public.treat_wallets tw ON tw.user_id = oal.user_id
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  -- By-artist breakdown using default + per-artist overrides
  WITH base AS (
    SELECT
      oal.artist_profile_id,
      ap.stage_name,
      oal.org_split_pct_override,
      COALESCE(u.total_earnings, 0)::numeric AS gross_total,
      COALESCE(oal.org_split_pct_override, v_default_org_split_pct)::numeric AS org_split_pct_used,
      ROUND(COALESCE(u.total_earnings, 0)::numeric * (COALESCE(oal.org_split_pct_override, v_default_org_split_pct) / 100.0), 2) AS org_share_total,
      ROUND(COALESCE(u.total_earnings, 0)::numeric * (1 - (COALESCE(oal.org_split_pct_override, v_default_org_split_pct) / 100.0)), 2) AS artist_share_total,
      COALESCE((
        SELECT SUM(acdp.payout_usd)
        FROM public.ad_creator_daily_payouts acdp
        WHERE acdp.artist_id = ap.artist_id
          AND acdp.revenue_date >= v_period_start
          AND acdp.revenue_date <= v_period_end
      ), 0)::numeric AS period_ads
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    LEFT JOIN public.users u ON u.id = oal.user_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
  )
  SELECT
    COALESCE(SUM(org_share_total), 0),
    COALESCE(SUM(artist_share_total), 0)
  INTO
    v_org_share_total,
    v_artist_share_total
  FROM base;

  WITH base AS (
    SELECT
      oal.artist_profile_id,
      ap.stage_name,
      oal.org_split_pct_override,
      COALESCE(u.total_earnings, 0)::numeric AS gross_total,
      COALESCE(oal.org_split_pct_override, v_default_org_split_pct)::numeric AS org_split_pct_used,
      ROUND(COALESCE(u.total_earnings, 0)::numeric * (COALESCE(oal.org_split_pct_override, v_default_org_split_pct) / 100.0), 2) AS org_share_total,
      ROUND(COALESCE(u.total_earnings, 0)::numeric * (1 - (COALESCE(oal.org_split_pct_override, v_default_org_split_pct) / 100.0)), 2) AS artist_share_total,
      COALESCE((
        SELECT SUM(acdp.payout_usd)
        FROM public.ad_creator_daily_payouts acdp
        WHERE acdp.artist_id = ap.artist_id
          AND acdp.revenue_date >= v_period_start
          AND acdp.revenue_date <= v_period_end
      ), 0)::numeric AS period_ads
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    LEFT JOIN public.users u ON u.id = oal.user_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
  ),
  top_base AS (
    SELECT *
    FROM base
    ORDER BY gross_total DESC
    LIMIT 50
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'artist_profile_id', tb.artist_profile_id,
      'stage_name', tb.stage_name,
      'gross_total', tb.gross_total,
      'org_share_total', tb.org_share_total,
      'artist_share_total', tb.artist_share_total,
      'total_earnings', tb.artist_share_total,
      'org_split_pct_override', tb.org_split_pct_override,
      'org_split_pct', tb.org_split_pct_used,
      'artist_split_pct', 100 - tb.org_split_pct_used,
      'period_ads', tb.period_ads,
      'pct_of_org', CASE WHEN v_gross_total > 0 THEN ROUND((tb.gross_total / v_gross_total) * 100, 1) ELSE 0 END
    )
    ORDER BY tb.gross_total DESC
  ), '[]'::jsonb)
  INTO v_by_artist
  FROM top_base tb;

  -- Monthly trend (kept as gross payout)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('month', m.month, 'amount', m.amount)
    ORDER BY m.month
  ), '[]'::jsonb)
  INTO v_monthly
  FROM (
    SELECT
      to_char(date_trunc('month', acdp.revenue_date), 'YYYY-MM') AS month,
      COALESCE(SUM(acdp.payout_usd), 0)::numeric AS amount
    FROM public.ad_creator_daily_payouts acdp
    JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
    JOIN public.organization_artist_links oal
      ON oal.artist_profile_id = ap.id
     AND oal.organization_id = p_org_id
     AND oal.status = 'active'
    WHERE acdp.revenue_date >= (v_period_end - interval '12 months')::date
    GROUP BY 1
    ORDER BY 1
  ) m;

  RETURN jsonb_build_object(
    'period_days', v_days,
    'org_split_pct', v_default_org_split_pct,
    'artist_split_pct', v_default_artist_split_pct,
    'gross_total', v_gross_total,
    'org_share_total', v_org_share_total,
    'artist_share_total', v_artist_share_total,
    'available', GREATEST(v_gross_total - v_pending, 0),
    'total', v_gross_total,
    'treats', v_pending,
    'ads', v_period,
    'pending', v_pending,
    'by_artist', v_by_artist,
    'monthly_trend', v_monthly
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_revenue(uuid, int) TO authenticated;

