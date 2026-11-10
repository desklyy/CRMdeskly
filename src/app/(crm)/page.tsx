import { createClient } from "@/lib/supabase/server";
import {
  DashboardView,
  type FunnelPoint,
  type MonthlyPoint,
} from "@/components/crm/dashboard-view";

export default async function DashboardPage() {
  const supabase = await createClient();

  const now = new Date();
  const startOfMonthIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString();

  const [leadsRes, dealsRes, pipelinesRes, stagesRes, activitiesRes, profilesRes] =
    await Promise.all([
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfMonthIso),
      supabase
        .from("deals")
        .select("id, amount, status, stage_id, pipeline_id, created_at, closed_at"),
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

  // Últimos 6 meses
  const monthlySeries: MonthlyPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });

    const createdValue = deals
      .filter((deal) => deal.created_at.startsWith(key))
      .reduce((sum, deal) => sum + Number(deal.amount || 0), 0);

    const wonValue = wonDeals
      .filter((deal) => (deal.closed_at ?? deal.created_at).startsWith(key))
      .reduce((sum, deal) => sum + Number(deal.amount || 0), 0);

    monthlySeries.push({ month: label, pipeline: createdValue, won: wonValue });
  }

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

  return (
    <DashboardView
      kpis={{
        leadsThisMonth: leadsRes.count ?? 0,
        openPipelineValue,
        openDealsCount: openDeals.length,
        winRatePct,
        averageTicket,
      }}
      monthlySeries={monthlySeries}
      funnelSeries={funnelSeries}
      initialActivities={activitiesRes.data ?? []}
      profileNames={profileNames}
    />
  );
}
