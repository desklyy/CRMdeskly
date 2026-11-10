-- ============================================================================
-- Deskly CRM - Migración 0005: Columnas base department y lead_status en contacts
-- ============================================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS lead_status TEXT NOT NULL DEFAULT 'Nuevo';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contacts_lead_status_check'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_lead_status_check CHECK (
        lead_status IN (
          'Nuevo',
          'Contactado',
          'En Conversación',
          'Finalizado',
          'Negocio Abierto',
          'Sin Calificar'
        )
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_contacts_lead_status ON public.contacts(lead_status);
CREATE INDEX IF NOT EXISTS idx_contacts_department ON public.contacts(department);

-- Actualizar ingest_new_lead para soportar department y lead_status
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
  v_department TEXT;
  v_lead_status TEXT;
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
  v_department := NULLIF(TRIM(payload->>'department'), '');
  v_lead_status := COALESCE(NULLIF(TRIM(payload->>'lead_status'), ''), 'Nuevo');
  IF v_lead_status NOT IN ('Nuevo', 'Contactado', 'En Conversación', 'Finalizado', 'Negocio Abierto', 'Sin Calificar') THEN
    v_lead_status := 'Nuevo';
  END IF;
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

  SELECT id INTO v_contact_id FROM public.contacts WHERE email = v_email LIMIT 1;
  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts (
      company_id, first_name, last_name, email, phone, job_title, department, lead_status, lead_source, custom_fields
    )
    VALUES (
      v_company_id, v_first_name, v_last_name, v_email, v_phone, v_job_title, v_department, v_lead_status, v_lead_source, v_contact_cf
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
      department = COALESCE(NULLIF(department, ''), v_department),
      lead_source = COALESCE(NULLIF(lead_source, ''), v_lead_source),
      custom_fields = custom_fields || v_contact_cf
    WHERE id = v_contact_id;
  END IF;

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

