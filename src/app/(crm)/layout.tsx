import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { opportunisticRenewSubscriptionsIfNeeded } from "@/lib/microsoft/graph";
import { buildFullName, computeAvatarInitials } from "@/lib/crm/profiles";
import { AppShell } from "@/components/layout/app-shell";
import type { UserRole } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    redirect("/login?setup=missing_env");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, { data: oauthConn }] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, full_name, email, avatar_initials, role, is_active")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("oauth_connections")
      .select("is_auth_invalid")
      .eq("user_id", user.id)
      .eq("provider", "microsoft")
      .maybeSingle(),
  ]);

  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  if (oauthConn && !oauthConn.is_auth_invalid) {
    void opportunisticRenewSubscriptionsIfNeeded(user.id);
  }

  const metaFirst = (user.user_metadata?.first_name as string | undefined)?.trim();
  const metaLast = (user.user_metadata?.last_name as string | undefined)?.trim();
  const fallbackName =
    (metaFirst ? buildFullName(metaFirst, metaLast) : null) ||
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Usuario";
  const fallbackInitials = computeAvatarInitials(metaFirst || fallbackName, metaLast);

  const resolvedProfile = {
    full_name: profile?.full_name ?? fallbackName,
    email: profile?.email ?? user.email ?? "",
    avatar_initials: profile?.avatar_initials ?? fallbackInitials,
    role: (profile?.role ?? "sales") as UserRole,
  };

  return (
    <AppShell
      profile={resolvedProfile}
      outlookAuthInvalid={Boolean(oauthConn?.is_auth_invalid)}
    >
      {children}
    </AppShell>
  );
}

