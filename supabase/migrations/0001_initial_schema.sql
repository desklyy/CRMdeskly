-- ============================================================================
-- Deskly CRM - Migración 0001: Esquema Inicial de Base de Datos
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. USUARIOS Y ROLES (sincronizado con auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  avatar_initials TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales' CHECK (role IN ('admin', 'sales')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. DEFINICIÓN DE VARIABLES Y PROPIEDADES PERSONALIZADAS (API-First)
CREATE TABLE custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'contact', 'deal')),
  key TEXT NOT NULL, -- auto-generada en snake_case, inmutable tras crearse
  label TEXT NOT NULL,
  description TEXT,
  section TEXT NOT NULL DEFAULT 'Propiedades personalizadas',
  field_type TEXT NOT NULL CHECK (
    field_type IN ('text', 'number', 'currency', 'select', 'multi_select', 'date', 'boolean', 'url')
  ),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_value JSONB,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  field_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, key)
);

-- 3. EMPRESAS Y CONTACTOS
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  website TEXT,
  tax_id TEXT,
  billing_address TEXT,
  billing_city TEXT,
  billing_postal_code TEXT,
  country TEXT DEFAULT 'ES',
  industry TEXT,
  company_size TEXT,
  linkedin_url TEXT,
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  job_title TEXT,
  linkedin_url TEXT,
  lead_source TEXT,
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. PIPELINES DINÁMICOS (EMBUDOS)
CREATE TABLE pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  stale_days_default INTEGER NOT NULL DEFAULT 7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  color_code TEXT NOT NULL DEFAULT '#64748b',
  stale_days_override INTEGER,
  probability INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  is_won_stage BOOLEAN NOT NULL DEFAULT FALSE,
  is_lost_stage BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pipeline_id, id)
);

-- 5. NEGOCIOS (DEALS) Y MULTI-CONTACTO
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  position DOUBLE PRECISION NOT NULL DEFAULT 1000,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  lead_source TEXT,
  probability INTEGER CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  lost_reason TEXT,
  next_action TEXT,
  next_action_date DATE,
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (pipeline_id, stage_id) REFERENCES pipeline_stages(pipeline_id, id) ON DELETE RESTRICT
);

CREATE TABLE deal_contacts (
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role_in_deal TEXT,
  PRIMARY KEY (deal_id, contact_id)
);

-- 6. PRESUPUESTOS Y LÍNEAS DE CONCEPTO
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT UNIQUE NOT NULL,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  valid_until DATE,
  terms TEXT,
  billing_snapshot JSONB,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_order INTEGER NOT NULL DEFAULT 0,
  concept TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- 7. INTEGRACIÓN MICROSOFT OUTLOOK (EMAILS Y CALENDARIO)
CREATE TABLE oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'microsoft',
  microsoft_email TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  graph_subscription_id TEXT,
  subscription_expires_at TIMESTAMPTZ,
  calendar_subscription_id TEXT,
  calendar_subscription_expires_at TIMESTAMPTZ,
  is_auth_invalid BOOLEAN NOT NULL DEFAULT FALSE,
  last_auth_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ms_graph_id TEXT NOT NULL,
  internet_message_id TEXT UNIQUE,
  ms_conversation_id TEXT,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  from_email TEXT NOT NULL,
  to_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT,
  body_preview TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, ms_graph_id)
);

CREATE TABLE calendar_event_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ms_event_id TEXT NOT NULL,
  ical_uid TEXT,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ms_event_id)
);

-- 8. TIMELINE GLOBAL DE EVENTOS ESTRUCTURADOS (AUDITORÍA)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'ai_agent', 'webhook', 'system')),
  actor_id UUID,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'contact', 'deal', 'quote', 'calendar_event')),
  entity_id UUID NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. PORTAL API PARA AGENTES IA
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT 'read_write' CHECK (permissions IN ('read', 'read_write')),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ÍNDICES
CREATE INDEX idx_deals_pipeline_stage ON deals(pipeline_id, stage_id, position);
CREATE INDEX idx_deals_company ON deals(company_id);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_emails_contact_sent ON emails(contact_id, sent_at DESC);
CREATE INDEX idx_emails_deal_sent ON emails(deal_id, sent_at DESC);
CREATE INDEX idx_calendar_links_deal ON calendar_event_links(deal_id);
CREATE INDEX idx_calendar_links_company ON calendar_event_links(company_id);
CREATE INDEX idx_calendar_links_contact ON calendar_event_links(contact_id);
CREATE INDEX idx_calendar_links_user ON calendar_event_links(user_id);
CREATE INDEX idx_calendar_links_ical_uid ON calendar_event_links(ical_uid);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_activities_deal ON activities(deal_id, created_at DESC);
CREATE INDEX idx_companies_custom_fields ON companies USING GIN (custom_fields);
CREATE INDEX idx_contacts_custom_fields ON contacts USING GIN (custom_fields);
CREATE INDEX idx_deals_custom_fields ON deals USING GIN (custom_fields);

-- TRIGGER AUTOMÁTICO updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_deals_updated_at BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_quotes_updated_at BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_oauth_connections_updated_at BEFORE UPDATE ON oauth_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- INMUTABILIDAD DE key EN custom_field_definitions
CREATE OR REPLACE FUNCTION public.prevent_custom_field_key_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.entity_type IS DISTINCT FROM OLD.entity_type THEN
    RAISE EXCEPTION 'custom_field_definitions.key and entity_type are immutable once created';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_custom_field_immutable_key
  BEFORE UPDATE ON custom_field_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_custom_field_key_change();

-- SUPABASE REALTIME
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'deals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deals;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'activities'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activities;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'custom_field_definitions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE custom_field_definitions;
  END IF;
END;
$$;

