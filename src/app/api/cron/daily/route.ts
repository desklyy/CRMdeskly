import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureUserSubscriptions, isMicrosoftConfigured } from "@/lib/microsoft/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Cron diario compatible con Vercel Hobby:
 * 1) Mantiene activo el proyecto Supabase Free (evita pausa tras 7 días).
 * 2) Renueva en paralelo las suscripciones Microsoft Graph (Mail + Calendar) con <48h antes de vencer.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";

  if (!cronSecret || !timingSafeEqualStr(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1) Keep-alive ligero en Supabase Free
  const { error: pingError } = await admin
    .from("pipelines")
    .select("id")
    .limit(1);

  if (pingError) {
    return NextResponse.json(
      { error: `Supabase keep-alive failed: ${pingError.message}` },
      { status: 500 }
    );
  }

  if (!isMicrosoftConfigured()) {
    return NextResponse.json({
      ok: true,
      supabaseKeepAlive: true,
      renewed: 0,
      note: "Microsoft OAuth no configurado todavía",
    });
  }

  // 2) Renovación paralela de suscripciones Graph con <48h restantes
  const thresholdIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { data: connections } = await admin
    .from("oauth_connections")
    .select("user_id, subscription_expires_at, calendar_subscription_expires_at")
    .eq("provider", "microsoft")
    .eq("is_auth_invalid", false);

  const dueConnections = (connections ?? []).filter((c) => {
    const mailDue = !c.subscription_expires_at || c.subscription_expires_at < thresholdIso;
    const calDue =
      !c.calendar_subscription_expires_at ||
      c.calendar_subscription_expires_at < thresholdIso;
    return mailDue || calDue;
  });

  const results = await Promise.allSettled(
    dueConnections.map((c) => ensureUserSubscriptions(c.user_id))
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({
    ok: true,
    supabaseKeepAlive: true,
    checked: dueConnections.length,
    succeeded,
    failed,
  });
}

