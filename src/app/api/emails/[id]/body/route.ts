import { NextResponse } from "next/server";
import { verifyActiveSession } from "@/lib/supabase/auth-guard";
import { fetchOutlookMessage, OutlookAuthInvalidError } from "@/lib/microsoft/graph";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await verifyActiveSession();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const { supabase, user } = session;

  const { data: emailRow, error } = await supabase
    .from("emails")
    .select("id, ms_graph_id, user_id, subject, body_preview")
    .eq("id", id)
    .maybeSingle();

  if (error || !emailRow) {
    return NextResponse.json({ error: "Correo no encontrado" }, { status: 404 });
  }

  const ownerUserId = emailRow.user_id ?? user.id;

  try {
    const msg = await fetchOutlookMessage(ownerUserId, emailRow.ms_graph_id, true);
    return NextResponse.json({
      id: emailRow.id,
      subject: msg.subject ?? emailRow.subject,
      contentType: msg.body?.contentType ?? "Text",
      content: msg.body?.content ?? emailRow.body_preview ?? "",
    });
  } catch (err) {
    if (err instanceof OutlookAuthInvalidError) {
      return NextResponse.json(
        { error: err.message, authInvalid: true },
        { status: 401 }
      );
    }
    return NextResponse.json({
      id: emailRow.id,
      subject: emailRow.subject,
      contentType: "Text",
      content: emailRow.body_preview ?? "",
      fallbackPreview: true,
    });
  }
}

