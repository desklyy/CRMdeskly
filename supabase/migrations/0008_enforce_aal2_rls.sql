-- ============================================================================
-- Deskly CRM - Migración 0008: Exigir nivel MFA AAL2 en RLS y RPCs
-- ============================================================================
-- Si el usuario tiene un factor TOTP verificado en auth.mfa_factors, cualquier
-- lectura/escritura vía PostgREST o RPCs exige una sesión JWT con aal = 'aal2'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_user_passes_mfa()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL THEN FALSE
    WHEN EXISTS (
      SELECT 1
      FROM auth.mfa_factors f
      WHERE f.user_id = (SELECT auth.uid())
        AND f.status = 'verified'
    )
      THEN COALESCE((SELECT auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    ELSE TRUE
  END;
$$;

REVOKE ALL ON FUNCTION public.current_user_passes_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_passes_mfa() TO authenticated;

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'profiles',
    'custom_field_definitions',
    'companies',
    'contacts',
    'pipelines',
    'pipeline_stages',
    'deals',
    'deal_contacts',
    'quotes',
    'quote_items',
    'oauth_connections',
    'emails',
    'calendar_event_links',
    'activities',
    'api_keys'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS require_mfa_aal2 ON public.%I;', v_table);
    EXECUTE format(
      'CREATE POLICY require_mfa_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_passes_mfa()) WITH CHECK (public.current_user_passes_mfa());',
      v_table
    );
  END LOOP;
END;
$$;

-- Endurecer RPC update_my_email_signature para exigir también AAL2 cuando aplique
CREATE OR REPLACE FUNCTION public.update_my_email_signature(p_signature TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cleaned TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() OR NOT public.current_user_passes_mfa() THEN
    RAISE EXCEPTION 'Usuario no autenticado, inactivo o pendiente de verificación 2FA';
  END IF;

  v_cleaned := NULLIF(TRIM(COALESCE(p_signature, '')), '');

  UPDATE public.profiles
  SET email_signature = v_cleaned
  WHERE id = v_uid;

  RETURN v_cleaned;
END;
$$;

-- Endurecer RPC append_custom_field_option para exigir también AAL2 cuando aplique
CREATE OR REPLACE FUNCTION public.append_custom_field_option(
  p_field_id UUID,
  p_new_option JSONB
)
RETURNS public.custom_field_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_is_active BOOLEAN;
  v_field public.custom_field_definitions;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT public.current_user_passes_mfa() THEN
    RAISE EXCEPTION 'Authentication and 2FA verification required';
  END IF;

  SELECT is_active INTO v_is_active
  FROM public.profiles
  WHERE id = v_uid;

  IF COALESCE(v_is_active, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Inactive or missing user profile';
  END IF;

  IF p_new_option IS NULL OR p_new_option = 'null'::jsonb THEN
    RAISE EXCEPTION 'new_option cannot be null';
  END IF;

  SELECT * INTO v_field
  FROM public.custom_field_definitions
  WHERE id = p_field_id AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Custom field not found or inactive';
  END IF;

  IF v_field.field_type NOT IN ('select', 'multi_select') THEN
    RAISE EXCEPTION 'Options can only be appended to select or multi_select fields';
  END IF;

  IF NOT (v_field.options @> jsonb_build_array(p_new_option)) THEN
    UPDATE public.custom_field_definitions
    SET options = options || jsonb_build_array(p_new_option)
    WHERE id = p_field_id
    RETURNING * INTO v_field;
  END IF;

  RETURN v_field;
END;
$$;

-- Endurecer search_path en triggers y revocar EXECUTE a anon (e ingest_new_lead también a authenticated)
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.prevent_custom_field_key_change() SET search_path = public;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_custom_field_key_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ingest_new_lead(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_new_lead(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.append_custom_field_option(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_custom_field_option(UUID, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_my_email_signature(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_email_signature(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.current_user_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.current_user_passes_mfa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_passes_mfa() TO authenticated, service_role;

