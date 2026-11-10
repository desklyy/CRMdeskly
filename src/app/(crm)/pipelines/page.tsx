import React, { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { KanbanBoard } from "@/components/crm/kanban-board";
import type { UserRole } from "@/types/database";

export default async function PipelinesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    pipelinesRes,
    stagesRes,
    dealsRes,
    companiesRes,
    contactsRes,
    profilesRes,
    defsRes,
    myProfileRes,
  ] = await Promise.all([
    supabase
      .from("pipelines")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("is_active", true)
      .order("stage_order", { ascending: true }),
    supabase
      .from("deals")
      .select("*")
      .order("position", { ascending: true }),
    supabase.from("companies").select("id, name").order("name", { ascending: true }),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, email, company_id")
      .order("first_name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, avatar_initials, role, email")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("custom_field_definitions")
      .select("*")
      .eq("entity_type", "deal")
      .eq("is_active", true)
      .order("field_order", { ascending: true }),
    user
      ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const role = (myProfileRes.data?.role ?? "sales") as UserRole;

  return (
    <Suspense fallback={<div className="text-xs text-slate-500">Cargando pipelines...</div>}>
      <KanbanBoard
        pipelines={pipelinesRes.data ?? []}
        stages={stagesRes.data ?? []}
        initialDeals={dealsRes.data ?? []}
        companies={companiesRes.data ?? []}
        contacts={contactsRes.data ?? []}
        profiles={profilesRes.data ?? []}
        initialDefinitions={defsRes.data ?? []}
        currentUserRole={role}
      />
    </Suspense>
  );
}
