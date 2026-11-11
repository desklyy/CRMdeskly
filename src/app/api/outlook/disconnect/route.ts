import { NextResponse } from "next/server";
import { verifyActiveSession } from "@/lib/supabase/auth-guard";

export async function POST() {
  const session = await verifyActiveSession();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const { supabase, user } = session;

  const { error } = await supabase
    .from("oauth_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", "microsoft");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

