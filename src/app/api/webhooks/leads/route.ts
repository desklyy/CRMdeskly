import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyLeadsSignature(request: NextRequest, rawBody: string): boolean {
  const secret = process.env.LEADS_WEBHOOK_SECRET;
  if (!secret) return false;

  const typeformSig = request.headers.get("typeform-signature");
  if (typeformSig) {
    const expected = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64")}`;
    return timingSafeMatch(typeformSig, expected);
  }

  const xSecret =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (xSecret) {
    return timingSafeMatch(xSecret.trim(), secret);
  }

  return false;
}

interface TypeformAnswer {
  type?: string;
  text?: string;
  email?: string;
  phone_number?: string;
  number?: number;
  url?: string;
  boolean?: boolean;
  choice?: { label?: string };
  choices?: { labels?: string[] };
  field?: { ref?: string; id?: string };
}

function normalizeLeadPayload(body: Record<string, unknown>): Record<string, Json> {
  // Soporte nativo para payload Typeform (`form_response.answers`)
  const formResponse = body.form_response as
    | { answers?: TypeformAnswer[]; hidden?: Record<string, string> }
    | undefined;

  if (!formResponse?.answers) {
    return body as Record<string, Json>;
  }

  const out: Record<string, Json> = {
    lead_source: "typeform",
  };
  const dealCustomFields: Record<string, Json> = {};

  for (const ans of formResponse.answers) {
    const ref = (ans.field?.ref || "").toLowerCase();
    const val: Json =
      ans.email ??
      ans.text ??
      ans.phone_number ??
      ans.url ??
      ans.choice?.label ??
      ans.choices?.labels ??
      ans.number ??
      ans.boolean ??
      null;

    if (val === null) continue;

    if (ans.type === "email" || ref === "email") {
      out.email = String(val);
    } else if (ref === "first_name" || ref === "nombre") {
      out.first_name = String(val);
    } else if (ref === "last_name" || ref === "apellidos") {
      out.last_name = String(val);
    } else if (ref === "phone" || ref === "telefono" || ans.type === "phone_number") {
      out.phone = String(val);
    } else if (ref === "company_name" || ref === "empresa") {
      out.company_name = String(val);
    } else if (ref === "website" || ref === "web") {
      out.website = String(val);
    } else if (ref === "job_title" || ref === "cargo") {
      out.job_title = String(val);
    } else if (ref === "department" || ref === "departamento") {
      out.department = String(val);
    } else if (ref === "lead_status" || ref === "estado_lead") {
      out.lead_status = String(val);
    } else if (ref === "amount" || ref === "presupuesto") {
      out.amount = Number(val) || 0;
    } else if (ref) {
      dealCustomFields[ref] = val;
    }
  }

  if (Object.keys(dealCustomFields).length > 0) {
    out.deal_custom_fields = dealCustomFields;
  }

  return out;
}

export async function POST(request: NextRequest) {
  if (!process.env.LEADS_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "LEADS_WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  if (!verifyLeadsSignature(request, rawBody)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const normalized = normalizeLeadPayload(parsed);
  if (!normalized.email) {
    return NextResponse.json(
      { error: "email is required in lead payload" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ingest_new_lead", {
    payload: normalized as Json,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, result: data }, { status: 201 });
}

