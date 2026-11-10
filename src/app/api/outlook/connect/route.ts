import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signOAuthState } from "@/lib/security/crypto";
import { getMicrosoftAuthUrl, isMicrosoftConfigured } from "@/lib/microsoft/graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  if (!isMicrosoftConfigured()) {
    return NextResponse.redirect(`${origin}/settings?outlook=missing_config`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const state = signOAuthState(user.id);
  const authUrl = getMicrosoftAuthUrl(state);
  return NextResponse.redirect(authUrl);
}

