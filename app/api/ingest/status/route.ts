import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "00000000-0000-0000-0000-000000000001";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ingest_job")
    .select("id,job_type,status,error,payload,created_at,updated_at")
    .eq("user_id", USER_ID)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobs: data });
}
