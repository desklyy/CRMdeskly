import { createClient } from "@/lib/supabase/server";
import {
  DashboardView,
  type EvolutionDealPoint,
  type FunnelPoint,
  type NextActionItem,
} from "@/components/crm/dashboard-view";

export default async function DashboardPage() {
  const supabase = await createClient();

  const now = new Date();
  const startOfMonthIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString();

  const [
    leadsRes,
    dealsRes,
    pipelinesRes,
    stagesRes,
    activitiesRes,
    profilesRes,
    companiesRes,
    tasksRes,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfMonthIso),
    supabase
      .from("deals")
      .select(
        "id, title, amount, status, stage_id, pipeline_id, created_at, closed_at, next_action, next_action_date, company_id"
      ),
    supabase
      .from("pipelines")
      .select("id, is_default")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("pipeline_stages")
      .select("id, pipeline_id, name, stage_order")
      .eq("is_active", true)
      .order("stage_order", { ascending: true }),
    supabase
      .from("activities")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("companies").select("id, name"),
    supabase
      .from("tasks")
      .select("id, title, task_type, status, priority, due_date, deal_id, company_id, contact_id")
      .in("status", ["pending", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(12),
  ]);

  const deals = dealsRes.data ?? [];
  const openDeals = deals.filter((d) => d.status === "open");
  const wonDeals = deals.filter((d) => d.status === "won");
  const lostDeals = deals.filter((d) => d.status === "lost");

  const openPipelineValue = openDeals.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const closedCount = wonDeals.length + lostDeals.length;
  const winRatePct = closedCount > 0 ? (wonDeals.length / closedCount) * 100 : 0;

  const valuedDeals = deals.filter((d) => Number(d.amount || 0) > 0);
  const averageTicket =
    valuedDeals.length > 0
      ? valuedDeals.reduce((sum, d) => sum + Number(d.amount || 0), 0) /
        valuedDeals.length
      : 0;

  const evolutionDeals: EvolutionDealPoint[] = deals.map((d) => ({
    amount: Number(d.amount || 0),
    status: d.status,
    created_at: d.created_at,
    closed_at: d.closed_at,
  }));

  const defaultPipeline =
    (pipelinesRes.data ?? []).find((p) => p.is_default) ??
    (pipelinesRes.data ?? [])[0];

  const funnelSeries: FunnelPoint[] = (stagesRes.data ?? [])
    .filter((s) => !defaultPipeline || s.pipeline_id === defaultPipeline.id)
    .map((stage) => {
      const stageDeals = deals.filter((d) => d.stage_id === stage.id);
      return {
        stage: stage.name,
        deals: stageDeals.length,
        value: stageDeals.reduce((sum, d) => sum + Number(d.amount || 0), 0),
      };
    });

  const profileNames: Record<string, string> = {};
  for (const p of profilesRes.data ?? []) {
    profileNames[p.id] = p.full_name;
  }

  const companyNames = new Map(
    (companiesRes.data ?? []).map((c) => [c.id, c.name])
  );
  const dealMap = new Map(deals.map((d) => [d.id, d]));

  const taskActionItems: NextActionItem[] = (tasksRes.data ?? []).map((t) => {
    const linkedDeal = t.deal_id ? dealMap.get(t.deal_id) : undefined;
    const resolvedCompanyId = t.company_id ?? linkedDeal?.company_id ?? null;
    const href = t.deal_id
      ? `/pipelines?deal=${t.deal_id}`
      : resolvedCompanyId
        ? `/companies?id=${resolvedCompanyId}`
        : t.contact_id
          ? `/contacts?id=${t.contact_id}`
          : "/tasks";

    return {
      key: `task-${t.id}`,
      kind: "task",
      href,
      title: t.title,
      subtitle: linkedDeal?.title ?? null,
      companyName: resolvedCompanyId ? companyNames.get(resolvedCompanyId) ?? null : null,
      nextAction: t.title,
      nextActionDate: t.due_date,
      amount: linkedDeal ? Number(linkedDeal.amount || 0) : null,
    };
  });

  const dealActionItems: NextActionItem[] = openDeals
    .filter((d) => Boolean(d.next_action || d.next_action_date))
    .map((d) => ({
      key: `deal-${d.id}`,
      kind: "deal_action",
      href: `/pipelines?deal=${d.id}`,
      title: d.title,
      subtitle: d.next_action || "Seguimiento programado",
      companyName: d.company_id ? companyNames.get(d.company_id) ?? null : null,
      nextAction: d.next_action,
      nextActionDate: d.next_action_date,
      amount: Number(d.amount || 0),
    }));

  const nextActions: NextActionItem[] = [...taskActionItems, ...dealActionItems]
    .sort((a, b) => {
      if (!a.nextActionDate && !b.nextActionDate) return 0;
      if (!a.nextActionDate) return 1;
      if (!b.nextActionDate) return -1;
      return a.nextActionDate.localeCompare(b.nextActionDate);
    })
    .slice(0, 8);

  return (
    <DashboardView
      kpis={{
        leadsThisMonth: leadsRes.count ?? 0,
        openPipelineValue,
        openDealsCount: openDeals.length,
        winRatePct,
        averageTicket,
      }}
      evolutionDeals={evolutionDeals}
      funnelSeries={funnelSeries}
      nextActions={nextActions}
      initialActivities={activitiesRes.data ?? []}
      profileNames={profileNames}
    />
  );
}
