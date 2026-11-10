-- ============================================================================
-- Deskly CRM - Migración 0002: Triggers Auth, RPCs y Seed Inicial
-- ============================================================================

-- 1. TRIGGER DE CREACIÓN AUTOMÁTICA DE PERFIL AL INVITAR/REGISTRAR USUARIO
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_initials TEXT;
  v_role TEXT;
  v_parts TEXT[];
BEGIN
  v_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    SPLIT_PART(NEW.email, '@', 1)
  );

  v_parts := REGEXP_SPLIT_TO_ARRAY(TRIM(v_full_name), '\s+');
  IF ARRAY_LENGTH(v_parts, 1) >= 2 THEN
    v_initials := UPPER(LEFT(v_parts[1], 1) || LEFT(v_parts[2], 1));
  ELSE
    v_initials := UPPER(LEFT(v_full_name, 2));
  END IF;

  v_role := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'sales');
  IF v_role NOT IN ('admin', 'sales') THEN
    v_role := 'sales';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, avatar_initials, role, is_active)
  VALUES (NEW.id, LOWER(NEW.email), v_full_name, v_initials, v_role, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        avatar_initials = EXCLUDED.avatar_initials;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 2. RPC SEGURA PARA QUE EL ROL 'sales' AÑADA OPCIONES A SELECT/MULTI_SELECT
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
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

REVOKE ALL ON FUNCTION public.append_custom_field_option(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_custom_field_option(UUID, JSONB) TO authenticated;

-- 3. RPC ATÓMICA PARA INGESTA DE LEADS (/api/webhooks/leads)
CREATE OR REPLACE FUNCTION public.ingest_new_lead(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_email_domain TEXT;
  v_domain TEXT;
  v_company_name TEXT;
  v_website TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_phone TEXT;
  v_job_title TEXT;
  v_lead_source TEXT;
  v_deal_title TEXT;
  v_amount NUMERIC(12,2);
  v_company_cf JSONB;
  v_contact_cf JSONB;
  v_deal_cf JSONB;
  v_company_id UUID;
  v_contact_id UUID;
  v_pipeline_id UUID;
  v_stage_id UUID;
  v_deal_id UUID;
  v_next_position DOUBLE PRECISION;
  v_created_company BOOLEAN := FALSE;
  v_created_contact BOOLEAN := FALSE;
  v_generic_domains TEXT[] := ARRAY[
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
    'live.com', 'msn.com', 'yahoo.com', 'yahoo.es', 'icloud.com',
    'me.com', 'proton.me', 'protonmail.com'
  ];
BEGIN
  v_email := LOWER(NULLIF(TRIM(payload->>'email'), ''));
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'payload.email is required';
  END IF;

  v_first_name := COALESCE(NULLIF(TRIM(payload->>'first_name'), ''), SPLIT_PART(v_email, '@', 1));
  v_last_name := NULLIF(TRIM(payload->>'last_name'), '');
  v_phone := NULLIF(TRIM(payload->>'phone'), '');
  v_job_title := NULLIF(TRIM(payload->>'job_title'), '');
  v_lead_source := COALESCE(NULLIF(TRIM(payload->>'lead_source'), ''), 'webhook');
  v_company_name := NULLIF(TRIM(payload->>'company_name'), '');
  v_website := NULLIF(TRIM(payload->>'website'), '');
  v_domain := LOWER(NULLIF(TRIM(payload->>'domain'), ''));
  v_amount := COALESCE((payload->>'amount')::NUMERIC(12,2), 0);
  v_company_cf := COALESCE(payload->'company_custom_fields', '{}'::jsonb);
  v_contact_cf := COALESCE(payload->'contact_custom_fields', '{}'::jsonb);
  v_deal_cf := COALESCE(payload->'deal_custom_fields', payload->'custom_fields', '{}'::jsonb);

  IF v_domain IS NULL AND v_website IS NOT NULL THEN
    v_domain := LOWER(REGEXP_REPLACE(REGEXP_REPLACE(v_website, '^https?://(www\.)?', ''), '/.*$', ''));
  END IF;

  IF v_domain IS NULL THEN
    v_email_domain := SPLIT_PART(v_email, '@', 2);
    IF v_email_domain <> '' AND NOT (v_email_domain = ANY(v_generic_domains)) THEN
      v_domain := v_email_domain;
    END IF;
  END IF;

  -- 3.1 Deduplicación / creación de Empresa
  IF v_domain IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE domain = v_domain LIMIT 1;
    IF v_company_id IS NULL THEN
      INSERT INTO public.companies (name, domain, website, custom_fields)
      VALUES (COALESCE(v_company_name, v_domain), v_domain, v_website, v_company_cf)
      RETURNING id INTO v_company_id;
      v_created_company := TRUE;
    ELSIF v_company_cf <> '{}'::jsonb THEN
      UPDATE public.companies
      SET custom_fields = custom_fields || v_company_cf
      WHERE id = v_company_id;
    END IF;
  ELSIF v_company_name IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE LOWER(name) = LOWER(v_company_name) LIMIT 1;
    IF v_company_id IS NULL THEN
      INSERT INTO public.companies (name, website, custom_fields)
      VALUES (v_company_name, v_website, v_company_cf)
      RETURNING id INTO v_company_id;
      v_created_company := TRUE;
    END IF;
  END IF;

  -- 3.2 Deduplicación / creación de Contacto
  SELECT id INTO v_contact_id FROM public.contacts WHERE email = v_email LIMIT 1;
  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts (
      company_id, first_name, last_name, email, phone, job_title, lead_source, custom_fields
    )
    VALUES (
      v_company_id, v_first_name, v_last_name, v_email, v_phone, v_job_title, v_lead_source, v_contact_cf
    )
    RETURNING id INTO v_contact_id;
    v_created_contact := TRUE;
  ELSE
    UPDATE public.contacts
    SET
      company_id = COALESCE(company_id, v_company_id),
      last_name = COALESCE(NULLIF(last_name, ''), v_last_name),
      phone = COALESCE(NULLIF(phone, ''), v_phone),
      job_title = COALESCE(NULLIF(job_title, ''), v_job_title),
      lead_source = COALESCE(NULLIF(lead_source, ''), v_lead_source),
      custom_fields = custom_fields || v_contact_cf
    WHERE id = v_contact_id;
  END IF;

  -- 3.3 Pipeline por defecto y primera etapa activa
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE is_default = TRUE AND is_active = TRUE
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'No active default pipeline configured';
  END IF;

  SELECT id INTO v_stage_id
  FROM public.pipeline_stages
  WHERE pipeline_id = v_pipeline_id
    AND is_active = TRUE
    AND is_won_stage = FALSE
    AND is_lost_stage = FALSE
  ORDER BY stage_order ASC
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'No active entry stage found for default pipeline';
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1000
  INTO v_next_position
  FROM public.deals
  WHERE pipeline_id = v_pipeline_id AND stage_id = v_stage_id;

  v_deal_title := COALESCE(
    NULLIF(TRIM(payload->>'deal_title'), ''),
    COALESCE(v_company_name, v_domain, v_first_name) || ' — Inbound'
  );

  INSERT INTO public.deals (
    title, amount, pipeline_id, stage_id, position, company_id, primary_contact_id, lead_source, custom_fields
  )
  VALUES (
    v_deal_title, v_amount, v_pipeline_id, v_stage_id, v_next_position, v_company_id, v_contact_id, v_lead_source, v_deal_cf
  )
  RETURNING id INTO v_deal_id;

  INSERT INTO public.deal_contacts (deal_id, contact_id, role_in_deal)
  VALUES (v_deal_id, v_contact_id, 'Contacto Principal')
  ON CONFLICT DO NOTHING;

  -- 3.4 Auditoría en activities
  INSERT INTO public.activities (
    actor_type, entity_type, entity_id, company_id, contact_id, deal_id, event_type, metadata
  )
  VALUES (
    'webhook',
    'deal',
    v_deal_id,
    v_company_id,
    v_contact_id,
    v_deal_id,
    'lead_ingested',
    jsonb_build_object(
      'lead_source', v_lead_source,
      'created_company', v_created_company,
      'created_contact', v_created_contact
    )
  );

  RETURN jsonb_build_object(
    'company_id', v_company_id,
    'contact_id', v_contact_id,
    'deal_id', v_deal_id,
    'created_company', v_created_company,
    'created_contact', v_created_contact
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_new_lead(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_new_lead(JSONB) TO service_role;

-- 4. SEED INICIAL: PIPELINE Y ETAPAS BASE
DO $$
DECLARE
  v_pipeline_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipelines WHERE is_default = TRUE) THEN
    INSERT INTO public.pipelines (name, is_default, is_active, stale_days_default)
    VALUES ('Ventas Deskly', TRUE, TRUE, 7)
    RETURNING id INTO v_pipeline_id;

    INSERT INTO public.pipeline_stages (pipeline_id, name, stage_order, color_code, probability, is_won_stage, is_lost_stage)
    VALUES
      (v_pipeline_id, 'Nuevo Lead', 1, '#64748b', 10, FALSE, FALSE),
      (v_pipeline_id, 'Cualificación', 2, '#3b82f6', 25, FALSE, FALSE),
      (v_pipeline_id, 'Propuesta / Presupuesto', 3, '#8b5cf6', 50, FALSE, FALSE),
      (v_pipeline_id, 'Negociación', 4, '#f59e0b', 75, FALSE, FALSE),
      (v_pipeline_id, 'Ganado', 5, '#10b981', 100, TRUE, FALSE),
      (v_pipeline_id, 'Perdido', 6, '#ef4444', 0, FALSE, TRUE);
  END IF;
END;
$$;

