-- ============================================================================
-- Deskly CRM - Migración 0004: Nombre y Apellido estructurados en profiles
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Rellenar first_name / last_name en filas existentes a partir de full_name
UPDATE public.profiles
SET
  first_name = COALESCE(NULLIF(first_name, ''), SPLIT_PART(TRIM(full_name), ' ', 1)),
  last_name = COALESCE(
    NULLIF(last_name, ''),
    NULLIF(TRIM(SUBSTRING(TRIM(full_name) FROM POSITION(' ' IN TRIM(full_name)) + 1)), '')
  )
WHERE POSITION(' ' IN TRIM(full_name)) > 0
   OR first_name IS NULL;

-- Actualizar trigger on_auth_user_created para usar first_name + last_name e iniciales (1ª letra nombre + 1ª letra apellido)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_name TEXT;
  v_last_name TEXT;
  v_full_name TEXT;
  v_initials TEXT;
  v_role TEXT;
  v_parts TEXT[];
BEGIN
  v_first_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), '');
  v_last_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'last_name'), '');

  IF v_first_name IS NOT NULL THEN
    v_full_name := TRIM(v_first_name || ' ' || COALESCE(v_last_name, ''));
  ELSE
    v_full_name := COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      SPLIT_PART(NEW.email, '@', 1)
    );
    v_parts := REGEXP_SPLIT_TO_ARRAY(TRIM(v_full_name), '\s+');
    v_first_name := v_parts[1];
    IF ARRAY_LENGTH(v_parts, 1) >= 2 THEN
      v_last_name := ARRAY_TO_STRING(v_parts[2:ARRAY_LENGTH(v_parts, 1)], ' ');
    END IF;
  END IF;

  IF v_last_name IS NOT NULL AND v_last_name <> '' THEN
    v_initials := UPPER(LEFT(v_first_name, 1) || LEFT(v_last_name, 1));
  ELSE
    v_initials := UPPER(LEFT(v_first_name, 2));
  END IF;

  v_role := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'sales');
  IF v_role NOT IN ('admin', 'sales') THEN
    v_role := 'sales';
  END IF;

  INSERT INTO public.profiles (
    id, email, first_name, last_name, full_name, avatar_initials, role, is_active
  )
  VALUES (
    NEW.id, LOWER(NEW.email), v_first_name, v_last_name, v_full_name, v_initials, v_role, TRUE
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
        last_name = COALESCE(EXCLUDED.last_name, public.profiles.last_name),
        full_name = EXCLUDED.full_name,
        avatar_initials = EXCLUDED.avatar_initials;

  RETURN NEW;
END;
$$;

