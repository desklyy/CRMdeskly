-- ============================================================================
-- Deskly CRM - Migración 0007: Sincronización de Cuestionario Operativo Web
-- ============================================================================
-- 1. Crea las propiedades fijas estructuradas en `custom_field_definitions`
--    bajo la sección "Cuestionario Operativo" (para Company y Deal).
-- 2. Actualiza `ingest_new_lead(payload)` para soportar `mode = 'questionnaire'`
--    enriqueciendo empresas/contactos existentes y reutilizando el negocio
--    abierto si ya existe (evitando duplicados).
-- ============================================================================

INSERT INTO public.custom_field_definitions (
  entity_type, key, label, description, section, field_type, options, is_required, is_active, field_order
)
VALUES
  -- Empresa (companies)
  (
    'company',
    'departamentos_empresa',
    'Departamentos y equipo',
    'Departamentos seleccionados y número de trabajadores indicado en el cuestionario',
    'Cuestionario Operativo',
    'text',
    '[]'::jsonb,
    FALSE,
    TRUE,
    100
  ),
  (
    'company',
    'procedimientos_por_departamento',
    'Procedimientos por departamento',
    'Procesos y tareas que realiza cada departamento',
    'Cuestionario Operativo',
    'text',
    '[]'::jsonb,
    FALSE,
    TRUE,
    101
  ),
  (
    'company',
    'erp_principal',
    'ERP principal',
    'Software principal donde se registran pedidos, almacén o facturación',
    'Cuestionario Operativo',
    'text',
    '[]'::jsonb,
    FALSE,
    TRUE,
    102
  ),
  (
    'company',
    'alojamiento_erp',
    'Alojamiento del ERP',
    'Infraestructura donde corre el ERP actual',
    'Cuestionario Operativo',
    'select',
    '["Servidor Local (On-Premise)", "Cloud / Servidor VPS", "Híbrido / No estoy seguro"]'::jsonb,
    FALSE,
    TRUE,
    103
  ),
  (
    'company',
    'crm_actual',
    'CRM comercial actual',
    'Herramienta CRM actual de la empresa',
    'Cuestionario Operativo',
    'text',
    '[]'::jsonb,
    FALSE,
    TRUE,
    104
  ),
  (
    'company',
    'correo_ofimatica',
    'Correo / Ofimática',
    'Suite de correo y ofimática utilizada',
    'Cuestionario Operativo',
    'text',
    '[]'::jsonb,
    FALSE,
    TRUE,
    105
  ),
  (
    'company',
    'almacen_archivos',
    'Almacén de archivos',
    'Repositorio documental o servidor de archivos principal',
    'Cuestionario Operativo',
    'text',
    '[]'::jsonb,
    FALSE,
    TRUE,
    106
  ),
  (
    'company',
    'privacidad_estricta',
    'Privacidad IA local estricta',
    'Exigencia de que los datos no viajen a IAs públicas',
    'Cuestionario Operativo',
    'boolean',
    '[]'::jsonb,
    FALSE,
    TRUE,
    107
  ),
  (
    'company',
    'red_local_minipc',
    'Red LAN disponible para Mini PC',
    'Disponibilidad de red local física para despliegue on-premise',
    'Cuestionario Operativo',
    'boolean',
    '[]'::jsonb,
    FALSE,
    TRUE,
    108
  ),
  -- Negocio (deals)
  (
    'deal',
    'volumen_mensual',
    'Volumen mensual (docs)',
    'Volumen mensual estimado de pedidos, albaranes o facturas',
    'Cuestionario Operativo',
    'select',
    '["Menos de 100/mes", "100 a 500/mes", "500 a 2.000/mes", "+2.000/mes"]'::jsonb,
    FALSE,
    TRUE,
    100
  ),
  (
    'deal',
    'tareas_manuales',
    'Tareas manuales / Puntos de dolor',
    'Tareas repetitivas y cuellos de botella declarados en el cuestionario',
    'Cuestionario Operativo',
    'text',
    '[]'::jsonb,
    FALSE,
    TRUE,
    101
  ),
  (
    'deal',
    'cuestionario_completado',
    'Cuestionario completado',
    'Indica si el cliente o lead ya completó el cuestionario operativo web',
    'Cuestionario Operativo',
    'boolean',
    '[]'::jsonb,
    FALSE,
    TRUE,
    102
  )
ON CONFLICT (entity_type, key) DO UPDATE
SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  section = EXCLUDED.section,
  field_type = EXCLUDED.field_type,
  options = EXCLUDED.options,
  is_active = TRUE,
  field_order = EXCLUDED.field_order;

-- ============================================================================
-- RPC atómica actualizada para leads y cuestionario operativo
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ingest_new_lead(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_email TEXT;
  v_email_domain TEXT;
  v_domain TEXT;
  v_company_name TEXT;
  v_website TEXT;
  v_industry TEXT;
  v_company_size TEXT;
  v_full_name TEXT;
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
  v_created_deal BOOLEAN := FALSE;
  v_generic_domains TEXT[] := ARRAY[
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
    'live.com', 'msn.com', 'yahoo.com', 'yahoo.es', 'icloud.com',
    'me.com', 'proton.me', 'protonmail.com'
  ];
BEGIN
  v_mode := COALESCE(LOWER(NULLIF(TRIM(payload->>'mode'), '')), 'lead');

  v_email := LOWER(NULLIF(TRIM(payload->>'email'), ''));
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'payload.email is required';
  END IF;

  v_full_name := NULLIF(TRIM(payload->>'full_name'), '');
  v_first_name := NULLIF(TRIM(payload->>'first_name'), '');
  v_last_name := NULLIF(TRIM(payload->>'last_name'), '');

  IF v_first_name IS NULL AND v_full_name IS NOT NULL THEN
    IF POSITION(' ' IN v_full_name) > 0 THEN
      v_first_name := SPLIT_PART(v_full_name, ' ', 1);
      v_last_name := COALESCE(v_last_name, NULLIF(TRIM(SUBSTRING(v_full_name FROM POSITION(' ' IN v_full_name) + 1)), ''));
    ELSE
      v_first_name := v_full_name;
    END IF;
  END IF;
  v_first_name := COALESCE(v_first_name, SPLIT_PART(v_email, '@', 1));

  v_phone := NULLIF(TRIM(payload->>'phone'), '');
  v_job_title := NULLIF(TRIM(payload->>'job_title'), '');
  v_department := NULLIF(TRIM(payload->>'department'), '');

  v_lead_status := NULLIF(TRIM(payload->>'lead_status'), '');
  IF v_lead_status IS NULL THEN
    v_lead_status := CASE WHEN v_mode = 'questionnaire' THEN 'En Conversación' ELSE 'Nuevo' END;
  END IF;
  IF v_lead_status NOT IN ('Nuevo', 'Contactado', 'En Conversación', 'Finalizado', 'Negocio Abierto', 'Sin Calificar') THEN
    v_lead_status := 'Nuevo';
  END IF;

  v_lead_source := COALESCE(
    NULLIF(TRIM(payload->>'lead_source'), ''),
    CASE WHEN v_mode = 'questionnaire' THEN 'cuestionario' ELSE 'webhook' END
  );

  v_company_name := NULLIF(TRIM(payload->>'company_name'), '');
  v_website := NULLIF(TRIM(payload->>'website'), '');
  v_domain := LOWER(NULLIF(TRIM(payload->>'domain'), ''));

  v_industry := NULLIF(TRIM(payload->>'industry'), '');
  IF v_industry = 'No especificado' THEN
    v_industry := NULL;
  END IF;

  v_company_size := NULLIF(TRIM(payload->>'company_size'), '');
  IF v_company_size = '+200' THEN
    v_company_size := '200+';
  ELSIF v_company_size = 'No especificado' THEN
    v_company_size := NULL;
  END IF;

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

  -- 1. Deduplicación / creación / enriquecimiento de Empresa
  IF v_domain IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE domain = v_domain LIMIT 1;
  END IF;

  IF v_company_id IS NULL AND v_company_name IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE LOWER(name) = LOWER(v_company_name) LIMIT 1;
  END IF;

  IF v_company_id IS NULL THEN
    IF v_domain IS NOT NULL OR v_company_name IS NOT NULL THEN
      INSERT INTO public.companies (name, domain, website, industry, company_size, custom_fields)
      VALUES (
        COALESCE(v_company_name, v_domain),
        v_domain,
        v_website,
        v_industry,
        v_company_size,
        v_company_cf
      )
      RETURNING id INTO v_company_id;
      v_created_company := TRUE;
    END IF;
  ELSE
    UPDATE public.companies
    SET
      name = COALESCE(NULLIF(name, ''), v_company_name),
      domain = COALESCE(domain, v_domain),
      website = COALESCE(NULLIF(website, ''), v_website),
      industry = COALESCE(v_industry, industry),
      company_size = COALESCE(v_company_size, company_size),
      custom_fields = custom_fields || v_company_cf,
      updated_at = NOW()
    WHERE id = v_company_id;
  END IF;

  -- 2. Deduplicación / creación / enriquecimiento de Contacto
  SELECT id INTO v_contact_id FROM public.contacts WHERE LOWER(email) = v_email LIMIT 1;
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
      first_name = CASE
        WHEN (first_name IS NULL OR first_name = '' OR first_name = SPLIT_PART(email, '@', 1)) AND v_first_name <> ''
          THEN v_first_name
        ELSE first_name
      END,
      last_name = COALESCE(NULLIF(last_name, ''), v_last_name),
      phone = COALESCE(NULLIF(phone, ''), v_phone),
      job_title = COALESCE(NULLIF(job_title, ''), v_job_title),
      department = COALESCE(NULLIF(department, ''), v_department),
      lead_status = CASE
        WHEN v_mode = 'questionnaire' AND lead_status IN ('Nuevo', 'Contactado', 'Sin Calificar')
          THEN 'En Conversación'
        ELSE lead_status
      END,
      lead_source = COALESCE(NULLIF(lead_source, ''), v_lead_source),
      custom_fields = custom_fields || v_contact_cf,
      updated_at = NOW()
    WHERE id = v_contact_id;
  END IF;

  -- 3. Negocio: en modo questionnaire reutiliza un Deal abierto existente si lo hay
  IF v_mode = 'questionnaire' THEN
    SELECT d.id
    INTO v_deal_id
    FROM public.deals d
    WHERE d.status = 'open'
      AND (
        d.primary_contact_id = v_contact_id
        OR EXISTS (
          SELECT 1 FROM public.deal_contacts dc
          WHERE dc.deal_id = d.id AND dc.contact_id = v_contact_id
        )
        OR (v_company_id IS NOT NULL AND d.company_id = v_company_id)
      )
    ORDER BY
      (d.primary_contact_id = v_contact_id) DESC,
      d.updated_at DESC
    LIMIT 1;
  END IF;

  IF v_deal_id IS NOT NULL THEN
    UPDATE public.deals
    SET
      company_id = COALESCE(company_id, v_company_id),
      primary_contact_id = COALESCE(primary_contact_id, v_contact_id),
      custom_fields = custom_fields || v_deal_cf,
      last_activity_at = NOW(),
      updated_at = NOW()
    WHERE id = v_deal_id;
  ELSE
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
      COALESCE(v_company_name, v_domain, v_first_name) ||
      CASE WHEN v_mode = 'questionnaire' THEN ' — Cuestionario' ELSE ' — Inbound' END
    );

    INSERT INTO public.deals (
      title, amount, pipeline_id, stage_id, position, company_id, primary_contact_id, lead_source, custom_fields
    )
    VALUES (
      v_deal_title, v_amount, v_pipeline_id, v_stage_id, v_next_position, v_company_id, v_contact_id, v_lead_source, v_deal_cf
    )
    RETURNING id INTO v_deal_id;
    v_created_deal := TRUE;
  END IF;

  INSERT INTO public.deal_contacts (deal_id, contact_id, role_in_deal)
  VALUES (v_deal_id, v_contact_id, 'Contacto Principal')
  ON CONFLICT DO NOTHING;

  -- 4. Auditoría en activities
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
    CASE WHEN v_mode = 'questionnaire' THEN 'questionnaire_completed' ELSE 'lead_ingested' END,
    jsonb_build_object(
      'mode', v_mode,
      'lead_source', v_lead_source,
      'created_company', v_created_company,
      'created_contact', v_created_contact,
      'created_deal', v_created_deal
    )
  );

  RETURN jsonb_build_object(
    'company_id', v_company_id,
    'contact_id', v_contact_id,
    'deal_id', v_deal_id,
    'created_company', v_created_company,
    'created_contact', v_created_contact,
    'created_deal', v_created_deal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_new_lead(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_new_lead(JSONB) TO service_role;

