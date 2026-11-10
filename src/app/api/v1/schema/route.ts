import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateApiV1 } from "@/lib/api/v1-auth";

export const dynamic = "force-dynamic";

const getCachedCrmSchema = unstable_cache(
  async () => {
    const admin = createAdminClient();
    const [pipelinesRes, stagesRes, fieldsRes] = await Promise.all([
      admin
        .from("pipelines")
        .select("id, name, is_default, stale_days_default")
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      admin
        .from("pipeline_stages")
        .select(
          "id, pipeline_id, name, stage_order, color_code, probability, stale_days_override, is_won_stage, is_lost_stage"
        )
        .eq("is_active", true)
        .order("stage_order", { ascending: true }),
      admin
        .from("custom_field_definitions")
        .select(
          "id, entity_type, key, label, description, section, field_type, options, default_value, is_required, field_order"
        )
        .eq("is_active", true)
        .order("field_order", { ascending: true }),
    ]);

    return {
      pipelines: pipelinesRes.data ?? [],
      stages: stagesRes.data ?? [],
      custom_fields: fieldsRes.data ?? [],
      cached_at: new Date().toISOString(),
    };
  },
  ["crm-schema"],
  { tags: ["crm-schema"], revalidate: 3600 }
);

export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const schema = await getCachedCrmSchema();
  return NextResponse.json(schema);
}

