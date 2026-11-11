import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TasksView } from "@/components/crm/tasks-view";

export default async function TasksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const cutoffIso = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const [tasksRes, olderCountRes, profilesRes, companiesRes, contactsRes, dealsRes] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .or(`status.in.(pending,in_progress),completed_at.gte.${cutoffIso},and(status.in.(completed,cancelled),completed_at.is.null,updated_at.gte.${cutoffIso})`)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .in("status", ["completed", "cancelled"])
        .or(`completed_at.lt.${cutoffIso},and(completed_at.is.null,updated_at.lt.${cutoffIso})`),
      supabase
        .from("profiles")
        .select("id, full_name, avatar_initials, role")
        .eq("is_active", true)
        .order("full_name", { ascending: true }),
      supabase.from("companies").select("id, name").order("name", { ascending: true }),
      supabase
        .from("contacts")
        .select("id, first_name, last_name, company_id")
        .order("first_name", { ascending: true }),
      supabase
        .from("deals")
        .select("id, title, company_id, status")
        .order("updated_at", { ascending: false }),
    ]);

  return (
    <TasksView
      currentUserId={user.id}
      initialTasks={tasksRes.data ?? []}
      olderCompletedCount={olderCountRes.count ?? 0}
      completedCutoffIso={cutoffIso}
      profiles={profilesRes.data ?? []}
      companies={companiesRes.data ?? []}
      contacts={contactsRes.data ?? []}
      deals={dealsRes.data ?? []}
    />
  );
}

