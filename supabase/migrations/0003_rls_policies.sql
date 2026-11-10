-- ============================================================================
-- Deskly CRM - Migración 0003: Row Level Security (RLS)
-- ============================================================================

-- Helpers SECURITY DEFINER para evitar recursión sobre profiles en políticas RLS
CREATE OR REPLACE FUNCTION public.current_user_is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_active FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = TRUE;
$$;

REVOKE ALL ON FUNCTION public.current_user_is_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- Activar RLS en todas las tablas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- 1. PROFILES
CREATE POLICY profiles_select_active ON profiles
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY profiles_update_admin ON profiles
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- 2. CUSTOM FIELD DEFINITIONS
-- Todos los usuarios activos pueden leer y crear nuevas variables; solo admin puede editar/borrar directamente.
-- El rol 'sales' añade opciones mediante RPC append_custom_field_option().
CREATE POLICY cfd_select_active ON custom_field_definitions
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY cfd_insert_active ON custom_field_definitions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_active()
    AND (created_by IS NULL OR created_by = auth.uid())
  );

CREATE POLICY cfd_update_admin ON custom_field_definitions
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY cfd_delete_admin ON custom_field_definitions
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- 3. COMPANIES
CREATE POLICY companies_select_active ON companies
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY companies_insert_active ON companies
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

CREATE POLICY companies_update_active ON companies
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY companies_delete_admin ON companies
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- 4. CONTACTS
CREATE POLICY contacts_select_active ON contacts
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY contacts_insert_active ON contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

CREATE POLICY contacts_update_active ON contacts
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY contacts_delete_admin ON contacts
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- 5. PIPELINES & PIPELINE STAGES
CREATE POLICY pipelines_select_active ON pipelines
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY pipelines_write_admin ON pipelines
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY stages_select_active ON pipeline_stages
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY stages_write_admin ON pipeline_stages
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- 6. DEALS & DEAL_CONTACTS
CREATE POLICY deals_select_active ON deals
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY deals_insert_active ON deals
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

CREATE POLICY deals_update_active ON deals
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY deals_delete_admin ON deals
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

CREATE POLICY deal_contacts_select_active ON deal_contacts
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY deal_contacts_insert_active ON deal_contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

CREATE POLICY deal_contacts_update_active ON deal_contacts
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY deal_contacts_delete_active ON deal_contacts
  FOR DELETE TO authenticated
  USING (public.current_user_is_active());

-- 7. QUOTES & QUOTE ITEMS
CREATE POLICY quotes_select_active ON quotes
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY quotes_insert_active ON quotes
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

CREATE POLICY quotes_update_active ON quotes
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY quotes_delete_admin ON quotes
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

CREATE POLICY quote_items_select_active ON quote_items
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY quote_items_insert_active ON quote_items
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

CREATE POLICY quote_items_update_active ON quote_items
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY quote_items_delete_active ON quote_items
  FOR DELETE TO authenticated
  USING (public.current_user_is_active());

-- 8. OAUTH CONNECTIONS (estrictamente por usuario propietario)
CREATE POLICY oauth_owner_all ON oauth_connections
  FOR ALL TO authenticated
  USING (public.current_user_is_active() AND user_id = auth.uid())
  WITH CHECK (public.current_user_is_active() AND user_id = auth.uid());

-- 9. EMAILS
CREATE POLICY emails_select_active ON emails
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY emails_insert_active ON emails
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

CREATE POLICY emails_delete_admin ON emails
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- 10. CALENDAR EVENT LINKS
CREATE POLICY calendar_links_select_active ON calendar_event_links
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY calendar_links_insert_own ON calendar_event_links
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active() AND user_id = auth.uid());

CREATE POLICY calendar_links_update_own ON calendar_event_links
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active() AND (user_id = auth.uid() OR public.current_user_role() = 'admin'))
  WITH CHECK (public.current_user_is_active() AND (user_id = auth.uid() OR public.current_user_role() = 'admin'));

CREATE POLICY calendar_links_delete_own ON calendar_event_links
  FOR DELETE TO authenticated
  USING (public.current_user_is_active() AND (user_id = auth.uid() OR public.current_user_role() = 'admin'));

-- 11. ACTIVITIES (inmutable para usuarios; solo lectura/inserción)
CREATE POLICY activities_select_active ON activities
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

CREATE POLICY activities_insert_active ON activities
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

CREATE POLICY activities_delete_admin ON activities
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- 12. API KEYS (solo admin)
CREATE POLICY api_keys_admin_only ON api_keys
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

