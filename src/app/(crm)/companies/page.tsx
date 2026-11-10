import React, { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { CompaniesView } from "@/components/crm/companies-view";
import type { UserRole } from "@/types/database";

export default async function CompaniesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [companiesRes, definitionsRes, profilesRes, myProfileRes] = await Promise.all([
    supabase
      .from("companies")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("custom_field_definitions")
      .select("*")
      .eq("entity_type", "company")
      .eq("is_active", true)
      .order("field_order", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, avatar_initials, role, email")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    user
      ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const role = (myProfileRes.data?.role ?? "sales") as UserRole;

  return (
    <Suspense fallback={<div className="text-xs text-slate-500">Cargando empresas...</div>}>
      <CompaniesView
        initialCompanies={companiesRes.data ?? []}
        initialDefinitions={definitionsRes.data ?? []}
        profiles={profilesRes.data ?? []}
        currentUserRole={role}
      />
    </Suspense>
  );
}
