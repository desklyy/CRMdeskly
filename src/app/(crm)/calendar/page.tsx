import { createClient } from "@/lib/supabase/server";
import { CalendarView } from "@/components/crm/calendar-view";

export default async function CalendarPage() {
  const supabase = await createClient();

  const [companiesRes, contactsRes, dealsRes] = await Promise.all([
    supabase.from("companies").select("id, name").order("name", { ascending: true }),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, email, company_id")
      .order("first_name", { ascending: true }),
    supabase
      .from("deals")
      .select("id, title, company_id")
      .eq("status", "open")
      .order("updated_at", { ascending: false }),
  ]);

  return (
    <CalendarView
      companies={companiesRes.data ?? []}
      contacts={contactsRes.data ?? []}
      deals={dealsRes.data ?? []}
    />
  );
}
