import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateApiV1,
  paginatedResponse,
  parsePagination,
} from "@/lib/api/v1-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request, false);
  if ("errorResponse" in auth) return auth.errorResponse;

  const sp = request.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp, 10, 50);
  const dealId = sp.get("deal_id")?.trim();
  const companyId = sp.get("company_id")?.trim();
  const contactId = sp.get("contact_id")?.trim();
  const since = sp.get("since")?.trim();

  const admin = createAdminClient();
  let query = admin
    .from("activities")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (dealId) query = query.eq("deal_id", dealId);
  if (companyId) query = query.eq("company_id", companyId);
  if (contactId) query = query.eq("contact_id", contactId);
  if (since) query = query.gte("created_at", since);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return paginatedResponse(data ?? [], count, limit, offset);
}

