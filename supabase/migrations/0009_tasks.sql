-- ============================================================================
-- Deskly CRM - Migración 0009: Módulo de Tareas (tasks)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'follow_up' CHECK (
    task_type IN ('call', 'email', 'meeting', 'quote', 'technical', 'follow_up', 'other')
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'in_progress', 'completed', 'cancelled')
  ),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (
    priority IN ('low', 'medium', 'high', 'urgent')
  ),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status_due
  ON public.tasks(assigned_to, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due
  ON public.tasks(status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON public.tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON public.tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON public.tasks(contact_id);

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Ampliar activities.entity_type para admitir 'task'
ALTER TABLE public.activities
  DROP CONSTRAINT IF EXISTS activities_entity_type_check;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_entity_type_check
  CHECK (entity_type IN ('company', 'contact', 'deal', 'quote', 'calendar_event', 'task'));

-- Publicación Realtime para tareas en vivo
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END;
$$;

-- Row Level Security (RLS + AAL2 restrictivo)
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select_active ON public.tasks;
CREATE POLICY tasks_select_active ON public.tasks
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

DROP POLICY IF EXISTS tasks_insert_active ON public.tasks;
CREATE POLICY tasks_insert_active ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active());

DROP POLICY IF EXISTS tasks_update_active ON public.tasks;
CREATE POLICY tasks_update_active ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

DROP POLICY IF EXISTS tasks_delete_owner_or_admin ON public.tasks;
CREATE POLICY tasks_delete_owner_or_admin ON public.tasks
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_active()
    AND (
      public.current_user_role() = 'admin'
      OR created_by = (SELECT auth.uid())
      OR assigned_to = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS require_mfa_aal2 ON public.tasks;
CREATE POLICY require_mfa_aal2 ON public.tasks
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.current_user_passes_mfa())
  WITH CHECK (public.current_user_passes_mfa());

