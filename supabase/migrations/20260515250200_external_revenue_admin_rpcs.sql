/*
  # External Revenue Sharing — Admin RPCs (CRUD + preview)

  RPCs:
    - admin_external_revenue_is_finance_role()   helper, finance-staff guard
    - admin_external_revenue_is_admin()          helper, hard-admin guard

    - admin_create_external_revenue_entry        admin/account creates entry
    - admin_update_external_revenue_entry        admin/account edits entry while UNLOCKED
    - admin_lock_external_revenue_entry          admin/account locks entry (irreversible)
    - admin_delete_external_revenue_entry        admin deletes if NOT locked / NOT distributed

    - admin_upsert_external_revenue_split        admin saves default/per-source split

    - admin_preview_external_revenue_distribution    preview only, NO crediting

  Conventions followed:
    SECURITY DEFINER + SET search_path TO public, pg_temp
    Returns jsonb with { success: bool, ... }
    All writes recorded via standard activity logging by the caller.
*/

-- ============================================================================
-- Helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_external_revenue_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.admin_external_revenue_is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_external_revenue_is_finance_role()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'account')
  );
$$;

GRANT EXECUTE ON FUNCTION public.admin_external_revenue_is_finance_role() TO authenticated;

-- ============================================================================
-- admin_create_external_revenue_entry
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_external_revenue_entry(
  p_entry_date date,
  p_source_code text,
  p_gross_amount_usd numeric,
  p_fees_usd numeric DEFAULT 0,
  p_net_amount_usd numeric DEFAULT NULL,
  p_distributable_amount_usd numeric DEFAULT 0,
  p_original_currency text DEFAULT 'USD',
  p_fx_rate_to_usd numeric DEFAULT 1.0,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_source_id uuid;
  v_net numeric;
  v_entry_id uuid;
BEGIN
  v_uid := auth.uid();
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_entry_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'entry_date is required');
  END IF;
  IF p_source_code IS NULL OR length(trim(p_source_code)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'source_code is required');
  END IF;
  IF p_gross_amount_usd IS NULL OR p_gross_amount_usd < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'gross_amount_usd must be >= 0');
  END IF;
  IF p_fees_usd IS NULL OR p_fees_usd < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'fees_usd must be >= 0');
  END IF;
  IF p_distributable_amount_usd IS NULL OR p_distributable_amount_usd < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'distributable_amount_usd must be >= 0');
  END IF;

  SELECT id INTO v_source_id
  FROM public.external_revenue_sources
  WHERE code = p_source_code AND is_active = true
  LIMIT 1;

  IF v_source_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown or inactive source_code');
  END IF;

  v_net := COALESCE(p_net_amount_usd, GREATEST(0, p_gross_amount_usd - p_fees_usd));

  IF v_net < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'net_amount_usd must be >= 0');
  END IF;
  IF v_net > p_gross_amount_usd THEN
    RETURN jsonb_build_object('success', false, 'error', 'net_amount_usd cannot exceed gross_amount_usd');
  END IF;
  IF p_distributable_amount_usd > v_net THEN
    RETURN jsonb_build_object('success', false, 'error', 'distributable_amount_usd cannot exceed net_amount_usd');
  END IF;

  INSERT INTO public.external_revenue_entries (
    entry_date, source_id,
    gross_amount_usd, fees_usd, net_amount_usd,
    distributable_amount_usd,
    original_currency, fx_rate_to_usd,
    reference, notes, metadata,
    created_by
  ) VALUES (
    p_entry_date, v_source_id,
    p_gross_amount_usd, COALESCE(p_fees_usd, 0), v_net,
    COALESCE(p_distributable_amount_usd, 0),
    COALESCE(p_original_currency, 'USD'), COALESCE(p_fx_rate_to_usd, 1.0),
    p_reference, p_notes, COALESCE(p_metadata, '{}'::jsonb),
    v_uid
  )
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_external_revenue_entry(
  date, text, numeric, numeric, numeric, numeric, text, numeric, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_external_revenue_entry(
  date, text, numeric, numeric, numeric, numeric, text, numeric, text, text, jsonb
) TO authenticated;

-- ============================================================================
-- admin_update_external_revenue_entry  (only while unlocked, not distributed)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_external_revenue_entry(
  p_entry_id uuid,
  p_entry_date date DEFAULT NULL,
  p_source_code text DEFAULT NULL,
  p_gross_amount_usd numeric DEFAULT NULL,
  p_fees_usd numeric DEFAULT NULL,
  p_net_amount_usd numeric DEFAULT NULL,
  p_distributable_amount_usd numeric DEFAULT NULL,
  p_original_currency text DEFAULT NULL,
  p_fx_rate_to_usd numeric DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_entry record;
  v_source_id uuid;
  v_gross numeric;
  v_fees numeric;
  v_net numeric;
  v_dist numeric;
BEGIN
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_entry FROM public.external_revenue_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  IF v_entry.is_locked THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a locked entry');
  END IF;

  IF EXISTS (SELECT 1 FROM public.external_revenue_distributions WHERE entry_id = p_entry_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a distributed entry');
  END IF;

  v_source_id := v_entry.source_id;
  IF p_source_code IS NOT NULL THEN
    SELECT id INTO v_source_id
    FROM public.external_revenue_sources
    WHERE code = p_source_code AND is_active = true
    LIMIT 1;
    IF v_source_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unknown or inactive source_code');
    END IF;
  END IF;

  v_gross := COALESCE(p_gross_amount_usd, v_entry.gross_amount_usd);
  v_fees  := COALESCE(p_fees_usd, v_entry.fees_usd);
  v_net   := COALESCE(p_net_amount_usd, GREATEST(0, v_gross - v_fees));
  v_dist  := COALESCE(p_distributable_amount_usd, v_entry.distributable_amount_usd);

  IF v_gross < 0 OR v_fees < 0 OR v_net < 0 OR v_dist < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amounts must be non-negative');
  END IF;
  IF v_net > v_gross THEN
    RETURN jsonb_build_object('success', false, 'error', 'net_amount_usd cannot exceed gross_amount_usd');
  END IF;
  IF v_dist > v_net THEN
    RETURN jsonb_build_object('success', false, 'error', 'distributable_amount_usd cannot exceed net_amount_usd');
  END IF;

  UPDATE public.external_revenue_entries SET
    entry_date = COALESCE(p_entry_date, entry_date),
    source_id = v_source_id,
    gross_amount_usd = v_gross,
    fees_usd = v_fees,
    net_amount_usd = v_net,
    distributable_amount_usd = v_dist,
    original_currency = COALESCE(p_original_currency, original_currency),
    fx_rate_to_usd = COALESCE(p_fx_rate_to_usd, fx_rate_to_usd),
    reference = COALESCE(p_reference, reference),
    notes = COALESCE(p_notes, notes),
    metadata = COALESCE(p_metadata, metadata)
  WHERE id = p_entry_id;

  RETURN jsonb_build_object('success', true, 'entry_id', p_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_external_revenue_entry(
  uuid, date, text, numeric, numeric, numeric, numeric, text, numeric, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_external_revenue_entry(
  uuid, date, text, numeric, numeric, numeric, numeric, text, numeric, text, text, jsonb
) TO authenticated;

-- ============================================================================
-- admin_lock_external_revenue_entry  (irreversible; required before distribute)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_lock_external_revenue_entry(
  p_entry_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_entry record;
BEGIN
  v_uid := auth.uid();
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_entry FROM public.external_revenue_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  IF v_entry.is_locked THEN
    RETURN jsonb_build_object('success', true, 'status', 'already_locked', 'entry_id', p_entry_id);
  END IF;

  UPDATE public.external_revenue_entries
  SET is_locked = true,
      locked_at = now(),
      locked_by = v_uid
  WHERE id = p_entry_id;

  RETURN jsonb_build_object('success', true, 'status', 'locked', 'entry_id', p_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_lock_external_revenue_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_lock_external_revenue_entry(uuid) TO authenticated;

-- ============================================================================
-- admin_delete_external_revenue_entry  (only admin, only if not locked/distributed)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_external_revenue_entry(
  p_entry_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_entry record;
BEGIN
  IF NOT public.admin_external_revenue_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin role required');
  END IF;

  SELECT * INTO v_entry FROM public.external_revenue_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  IF v_entry.is_locked THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot delete a locked entry');
  END IF;

  IF EXISTS (SELECT 1 FROM public.external_revenue_distributions WHERE entry_id = p_entry_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot delete a distributed entry');
  END IF;

  DELETE FROM public.external_revenue_entries WHERE id = p_entry_id;
  RETURN jsonb_build_object('success', true, 'entry_id', p_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_external_revenue_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_external_revenue_entry(uuid) TO authenticated;

-- ============================================================================
-- admin_upsert_external_revenue_split  (default or per-source override)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_upsert_external_revenue_split(
  p_source_code text DEFAULT NULL,
  p_creator_pool_percentage numeric DEFAULT NULL,
  p_listener_pool_percentage numeric DEFAULT NULL,
  p_creator_attribution text DEFAULT NULL,
  p_listener_attribution text DEFAULT NULL,
  p_attribution_window_days integer DEFAULT NULL,
  p_min_plays_for_creator_eligibility integer DEFAULT NULL,
  p_min_points_for_listener_eligibility integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_source_id uuid;
  v_creator numeric;
  v_listener numeric;
  v_creator_attr text;
  v_listener_attr text;
  v_window integer;
  v_min_plays integer;
  v_min_points integer;
  v_existing record;
  v_setting_id uuid;
BEGIN
  v_uid := auth.uid();
  IF NOT public.admin_external_revenue_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin role required');
  END IF;

  IF p_source_code IS NOT NULL THEN
    SELECT id INTO v_source_id
    FROM public.external_revenue_sources
    WHERE code = p_source_code AND is_active = true
    LIMIT 1;
    IF v_source_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unknown or inactive source_code');
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.external_revenue_split_settings
  WHERE is_active = true
    AND (
      (v_source_id IS NULL AND source_id IS NULL)
      OR (v_source_id IS NOT NULL AND source_id = v_source_id)
    )
  ORDER BY updated_at DESC
  LIMIT 1;

  v_creator       := COALESCE(p_creator_pool_percentage,  v_existing.creator_pool_percentage,  50.00);
  v_listener      := COALESCE(p_listener_pool_percentage, v_existing.listener_pool_percentage, 50.00);
  v_creator_attr  := COALESCE(p_creator_attribution,      v_existing.creator_attribution,      'plays_in_period');
  v_listener_attr := COALESCE(p_listener_attribution,     v_existing.listener_attribution,     'feed_contribution_pool');
  v_window        := COALESCE(p_attribution_window_days,  v_existing.attribution_window_days,  30);
  v_min_plays     := COALESCE(p_min_plays_for_creator_eligibility,   v_existing.min_plays_for_creator_eligibility,  1);
  v_min_points    := COALESCE(p_min_points_for_listener_eligibility, v_existing.min_points_for_listener_eligibility, 10);

  IF v_creator < 0 OR v_creator > 100 OR v_listener < 0 OR v_listener > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Percentages must be between 0 and 100');
  END IF;
  IF round((v_creator + v_listener)::numeric, 4) <> 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'creator + listener percentages must equal 100');
  END IF;
  IF v_creator_attr NOT IN ('equal_active','plays_in_period','manual') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid creator_attribution');
  END IF;
  IF v_listener_attr NOT IN ('feed_contribution_pool','proportional_points','equal_active_listeners') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid listener_attribution');
  END IF;
  IF v_window < 1 OR v_window > 365 THEN
    RETURN jsonb_build_object('success', false, 'error', 'attribution_window_days must be 1..365');
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.external_revenue_split_settings SET
      creator_pool_percentage = v_creator,
      listener_pool_percentage = v_listener,
      creator_attribution = v_creator_attr,
      listener_attribution = v_listener_attr,
      attribution_window_days = v_window,
      min_plays_for_creator_eligibility = v_min_plays,
      min_points_for_listener_eligibility = v_min_points,
      updated_by = v_uid,
      updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO v_setting_id;
  ELSE
    INSERT INTO public.external_revenue_split_settings (
      source_id, creator_pool_percentage, listener_pool_percentage,
      creator_attribution, listener_attribution, attribution_window_days,
      min_plays_for_creator_eligibility, min_points_for_listener_eligibility,
      is_active, updated_by
    ) VALUES (
      v_source_id, v_creator, v_listener,
      v_creator_attr, v_listener_attr, v_window,
      v_min_plays, v_min_points,
      true, v_uid
    )
    RETURNING id INTO v_setting_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'setting_id', v_setting_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_external_revenue_split(
  text, numeric, numeric, text, text, integer, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_external_revenue_split(
  text, numeric, numeric, text, text, integer, integer, integer
) TO authenticated;

-- ============================================================================
-- admin_get_external_revenue_split_for_source
-- Returns active split for given source code (or default if NULL/missing).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_external_revenue_split_for_source(
  p_source_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_source_id uuid;
  v_row record;
BEGIN
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_source_code IS NOT NULL THEN
    SELECT id INTO v_source_id
    FROM public.external_revenue_sources
    WHERE code = p_source_code
    LIMIT 1;
  END IF;

  SELECT * INTO v_row
  FROM public.external_revenue_split_settings
  WHERE is_active = true
    AND (
      (v_source_id IS NOT NULL AND source_id = v_source_id)
      OR (v_source_id IS NULL AND source_id IS NULL)
    )
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_row.id IS NULL AND v_source_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.external_revenue_split_settings
    WHERE is_active = true AND source_id IS NULL
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'split', NULL);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'split', jsonb_build_object(
      'id', v_row.id,
      'source_id', v_row.source_id,
      'creator_pool_percentage', v_row.creator_pool_percentage,
      'listener_pool_percentage', v_row.listener_pool_percentage,
      'creator_attribution', v_row.creator_attribution,
      'listener_attribution', v_row.listener_attribution,
      'attribution_window_days', v_row.attribution_window_days,
      'min_plays_for_creator_eligibility', v_row.min_plays_for_creator_eligibility,
      'min_points_for_listener_eligibility', v_row.min_points_for_listener_eligibility
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_external_revenue_split_for_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_external_revenue_split_for_source(text) TO authenticated;

-- ============================================================================
-- admin_preview_external_revenue_distribution
-- READ-ONLY preview. Shows pools + counts + samples. NO crediting.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_preview_external_revenue_distribution(
  p_entry_id uuid,
  p_sample_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_entry record;
  v_split record;
  v_creator_pool numeric;
  v_listener_pool numeric;
  v_platform_retained numeric;
  v_window_start date;
  v_window_end date;
  v_total_creator_metric numeric := 0;
  v_total_listener_metric numeric := 0;
  v_creator_count integer := 0;
  v_listener_count integer := 0;
  v_creator_samples jsonb := '[]'::jsonb;
  v_listener_samples jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_entry FROM public.external_revenue_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  -- Resolve split (per-source first, then default)
  SELECT * INTO v_split
  FROM public.external_revenue_split_settings
  WHERE is_active = true AND source_id = v_entry.source_id
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_split.id IS NULL THEN
    SELECT * INTO v_split
    FROM public.external_revenue_split_settings
    WHERE is_active = true AND source_id IS NULL
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;

  IF v_split.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active split settings configured');
  END IF;

  v_creator_pool      := round((v_entry.distributable_amount_usd * v_split.creator_pool_percentage  / 100.0)::numeric, 4);
  v_listener_pool     := round((v_entry.distributable_amount_usd * v_split.listener_pool_percentage / 100.0)::numeric, 4);
  v_platform_retained := round((v_entry.net_amount_usd - v_entry.distributable_amount_usd)::numeric, 4);

  v_window_end := v_entry.entry_date;
  v_window_start := (v_entry.entry_date - (v_split.attribution_window_days || ' days')::interval)::date;

  -- Creator-side: plays_in_period | equal_active | manual (manual = preview only counts artists with plays)
  IF v_split.creator_attribution IN ('plays_in_period', 'equal_active', 'manual') THEN
    WITH plays AS (
      SELECT s.artist_id, COUNT(*)::numeric AS plays_count
      FROM public.listening_history lh
      JOIN public.songs s ON s.id = lh.song_id
      WHERE s.artist_id IS NOT NULL
        AND lh.listened_at::date >= v_window_start
        AND lh.listened_at::date <= v_window_end
      GROUP BY s.artist_id
      HAVING COUNT(*) >= v_split.min_plays_for_creator_eligibility
    )
    SELECT COALESCE(SUM(
              CASE WHEN v_split.creator_attribution = 'plays_in_period' THEN plays_count ELSE 1 END
            ), 0),
           COUNT(*)
      INTO v_total_creator_metric, v_creator_count
    FROM plays;

    IF v_creator_count > 0 AND v_creator_pool > 0 THEN
      SELECT COALESCE(jsonb_agg(row_obj ORDER BY metric DESC NULLS LAST), '[]'::jsonb)
      INTO v_creator_samples
      FROM (
        WITH plays AS (
          SELECT s.artist_id, COUNT(*)::numeric AS plays_count
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE s.artist_id IS NOT NULL
            AND lh.listened_at::date >= v_window_start
            AND lh.listened_at::date <= v_window_end
          GROUP BY s.artist_id
          HAVING COUNT(*) >= v_split.min_plays_for_creator_eligibility
        ),
        ranked AS (
          SELECT a.artist_id, a.plays_count,
                 CASE WHEN v_split.creator_attribution = 'plays_in_period' THEN a.plays_count ELSE 1 END AS metric
          FROM plays a
        ),
        sums AS (SELECT SUM(metric) AS total FROM ranked)
        SELECT
          r.metric AS metric,
          jsonb_build_object(
            'artist_id', r.artist_id,
            'plays_count', r.plays_count,
            'metric', r.metric,
            'estimated_payout_usd', round((v_creator_pool * r.metric / NULLIF(s.total, 0))::numeric, 4)
          ) AS row_obj
        FROM ranked r CROSS JOIN sums s
        ORDER BY r.metric DESC NULLS LAST
        LIMIT GREATEST(0, COALESCE(p_sample_size, 25))
      ) q;
    END IF;
  END IF;

  -- Listener-side: feed_contribution_pool returns a single topup entry summary.
  IF v_split.listener_attribution = 'feed_contribution_pool' THEN
    v_listener_count := 0; -- consumed at next monthly conversion
    v_listener_samples := jsonb_build_array(jsonb_build_object(
      'note', 'Listener pool will be added to next monthly contribution conversion.',
      'topup_usd', v_listener_pool
    ));
  ELSIF v_split.listener_attribution = 'proportional_points' THEN
    WITH pts AS (
      SELECT user_id, current_period_points
      FROM public.listener_contribution_scores
      WHERE current_period_points >= v_split.min_points_for_listener_eligibility
    )
    SELECT COALESCE(SUM(current_period_points), 0), COUNT(*)
      INTO v_total_listener_metric, v_listener_count
    FROM pts;

    IF v_listener_count > 0 AND v_listener_pool > 0 THEN
      SELECT COALESCE(jsonb_agg(row_obj ORDER BY pts_value DESC NULLS LAST), '[]'::jsonb)
      INTO v_listener_samples
      FROM (
        WITH pts AS (
          SELECT user_id, current_period_points::numeric AS pts_value
          FROM public.listener_contribution_scores
          WHERE current_period_points >= v_split.min_points_for_listener_eligibility
        ),
        sums AS (SELECT SUM(pts_value) AS total FROM pts)
        SELECT
          p.pts_value AS pts_value,
          jsonb_build_object(
            'user_id', p.user_id,
            'points', p.pts_value,
            'estimated_payout_usd', round((v_listener_pool * p.pts_value / NULLIF(s.total, 0))::numeric, 4)
          ) AS row_obj
        FROM pts p CROSS JOIN sums s
        ORDER BY p.pts_value DESC NULLS LAST
        LIMIT GREATEST(0, COALESCE(p_sample_size, 25))
      ) q;
    END IF;
  ELSIF v_split.listener_attribution = 'equal_active_listeners' THEN
    SELECT COUNT(*)::integer, COUNT(*)::numeric
      INTO v_listener_count, v_total_listener_metric
    FROM public.listener_contribution_scores
    WHERE current_period_points >= v_split.min_points_for_listener_eligibility;

    IF v_listener_count > 0 AND v_listener_pool > 0 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', user_id,
        'estimated_payout_usd', round((v_listener_pool / v_listener_count)::numeric, 4)
      )), '[]'::jsonb)
      INTO v_listener_samples
      FROM (
        SELECT user_id
        FROM public.listener_contribution_scores
        WHERE current_period_points >= v_split.min_points_for_listener_eligibility
        ORDER BY current_period_points DESC NULLS LAST
        LIMIT GREATEST(0, COALESCE(p_sample_size, 25))
      ) q;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'entry', jsonb_build_object(
      'id', v_entry.id,
      'entry_date', v_entry.entry_date,
      'source_id', v_entry.source_id,
      'gross_amount_usd', v_entry.gross_amount_usd,
      'fees_usd', v_entry.fees_usd,
      'net_amount_usd', v_entry.net_amount_usd,
      'distributable_amount_usd', v_entry.distributable_amount_usd,
      'is_locked', v_entry.is_locked
    ),
    'split', jsonb_build_object(
      'creator_pool_percentage', v_split.creator_pool_percentage,
      'listener_pool_percentage', v_split.listener_pool_percentage,
      'creator_attribution', v_split.creator_attribution,
      'listener_attribution', v_split.listener_attribution,
      'attribution_window_days', v_split.attribution_window_days,
      'attribution_window_start', v_window_start,
      'attribution_window_end', v_window_end
    ),
    'pools', jsonb_build_object(
      'creator_pool_usd', v_creator_pool,
      'listener_pool_usd', v_listener_pool,
      'platform_retained_usd', v_platform_retained
    ),
    'counts', jsonb_build_object(
      'creators_eligible', v_creator_count,
      'listeners_eligible', v_listener_count
    ),
    'samples', jsonb_build_object(
      'creators', v_creator_samples,
      'listeners', v_listener_samples
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_preview_external_revenue_distribution(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_preview_external_revenue_distribution(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_preview_external_revenue_distribution(uuid, integer) IS
  'READ-ONLY preview of how an external_revenue_entry would be distributed. No crediting, no posting.';
