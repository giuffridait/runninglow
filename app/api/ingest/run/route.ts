import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGmailConnection } from "@/lib/auth/session";
import { MERCHANT_GMAIL_QUERY } from "@/lib/ingest/gmail";

const USER_ID = "00000000-0000-0000-0000-000000000001";

export async function POST() {
  const connection = await getGmailConnection();
  if (!connection) {
    return NextResponse.json({ ok: false, error: "gmail_not_connected" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  const { data: job, error } = await supabase
    .from("ingest_job")
    .insert({
      user_id: USER_ID,
      job_type: "gmail_fetch",
      status: "queued",
      payload: {
        query: MERCHANT_GMAIL_QUERY,
        merchant_scope: ["knuspr", "zooplus"],
        triggered_by: "manual_api",
      },
    })
    .select("id,job_type,status,created_at,payload")
    .single();

  if (error || !job) {
    return NextResponse.json(
      { ok: false, error: "job_create_failed", details: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, job });
}
