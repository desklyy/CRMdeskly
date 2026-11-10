import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, verifyOAuthState } from "@/lib/security/crypto";
import {
  ensureUserSubscriptions,
  exchangeMicrosoftCode,
  fetchMicrosoftProfile,
} from "@/lib/microsoft/graph";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam || !code || !state) {
    return NextResponse.redirect(
      `${origin}/settings?outlook=error&reason=${encodeURIComponent(errorParam || "missing_code")}`
    );
  }

  const verified = verifyOAuthState(state);
  if (!verified) {
    return NextResponse.redirect(`${origin}/settings?outlook=error&reason=invalid_state`);
  }

  try {
    const tokens = await exchangeMicrosoftCode(code);
    const msProfile = await fetchMicrosoftProfile(tokens.accessToken);
    const admin = createAdminClient();

    const { error: upsertErr } = await admin.from("oauth_connections").upsert(
      {
        user_id: verified.uid,
        provider: "microsoft",
        microsoft_email: msProfile.email,
        access_token_encrypted: encryptToken(tokens.accessToken),
        refresh_token_encrypted: encryptToken(tokens.refreshToken),
        expires_at: tokens.expiresAt,
        is_auth_invalid: false,
        last_auth_error: null,
      },
      { onConflict: "user_id,provider" }
    );

    if (upsertErr) {
      return NextResponse.redirect(
        `${origin}/settings?outlook=error&reason=${encodeURIComponent(upsertErr.message)}`
      );
    }

    await ensureUserSubscriptions(verified.uid).catch((err) => {
      console.warn("[outlook/callback] Subscription registration skipped/failed:", err);
    });

    return NextResponse.redirect(`${origin}/settings?outlook=connected`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    return NextResponse.redirect(
      `${origin}/settings?outlook=error&reason=${encodeURIComponent(message)}`
    );
  }
}

