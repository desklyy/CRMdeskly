import { NextResponse } from "next/server";
import { verifyActiveSession } from "@/lib/supabase/auth-guard";
import { signOAuthState } from "@/lib/security/crypto";
import { getMicrosoftAuthUrl, isMicrosoftConfigured } from "@/lib/microsoft/graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  if (!isMicrosoftConfigured()) {
    return NextResponse.redirect(`${origin}/settings?outlook=missing_config`);
  }

  const session = await verifyActiveSession();
  if (!session.ok) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const state = signOAuthState(session.user.id);
  const authUrl = getMicrosoftAuthUrl(state);
  return NextResponse.redirect(authUrl);
}

