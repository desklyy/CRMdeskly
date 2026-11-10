-- ============================================================================
-- Deskly CRM - Migración 0006: Firma personal de email en profiles
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_signature TEXT;

-- Permite a cualquier usuario activo (admin o sales) guardar su propia firma
-- sin otorgar UPDATE directo sobre role/is_active en RLS.
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
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RAISE EXCEPTION 'Usuario no autenticado o inactivo';
  END IF;

  v_cleaned := NULLIF(TRIM(COALESCE(p_signature, '')), '');

  UPDATE public.profiles
  SET email_signature = v_cleaned
  WHERE id = v_uid;

  RETURN v_cleaned;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_email_signature(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_email_signature(TEXT) TO authenticated;

