import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/components/settings/settings-view";
import type { UserRole } from "@/types/database";

interface SettingsPageProps {
  searchParams: Promise<{ outlook?: string; reason?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const resolvedParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = (myProfile?.role ?? "sales") as UserRole;
  const isAdmin = role === "admin";

  const [profilesRes, pipelinesRes, stagesRes, defsRes, oauthRes, apiKeysRes] =
    await Promise.all([
      isAdmin
        ? supabase.from("profiles").select("*").order("created_at", { ascending: true })
        : Promise.resolve({ data: [] }),
      isAdmin
        ? supabase.from("pipelines").select("*").order("created_at", { ascending: true })
        : Promise.resolve({ data: [] }),
      isAdmin
        ? supabase
            .from("pipeline_stages")
            .select("*")
            .order("stage_order", { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase
        .from("custom_field_definitions")
        .select("*")
        .order("field_order", { ascending: true }),
      supabase
        .from("oauth_connections")
        .select(
          "id, microsoft_email, is_auth_invalid, last_auth_error, subscription_expires_at, calendar_subscription_expires_at, updated_at"
        )
        .eq("user_id", user.id)
        .eq("provider", "microsoft")
        .maybeSingle(),
      isAdmin
        ? supabase
            .from("api_keys")
            .select(
              "id, name, key_prefix, permissions, last_used_at, is_active, revoked_at, created_at"
            )
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

  return (
    <SettingsView
      currentUserId={user.id}
      currentUserRole={role}
      profiles={profilesRes.data ?? []}
      pipelines={pipelinesRes.data ?? []}
      stages={stagesRes.data ?? []}
      definitions={defsRes.data ?? []}
      oauthConnection={oauthRes.data ?? null}
      apiKeys={apiKeysRes.data ?? []}
      outlookStatus={resolvedParams.outlook}
      outlookReason={resolvedParams.reason}
    />
  );
}
