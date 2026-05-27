import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "00000000-0000-0000-0000-000000000001";

export async function POST() {
  const supabase = createSupabaseServerClient();

  const { data: queuedJob, error: queuedJobError } = await supabase
    .from("ingest_job")
    .select("id,job_type,status,payload")
    .eq("user_id", USER_ID)
    .eq("job_type", "gmail_fetch")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (queuedJobError) {
    return NextResponse.json({ ok: false, error: "job_query_failed", details: queuedJobError.message }, { status: 500 });
  }

  if (!queuedJob) {
    return NextResponse.json({ ok: true, processed: false, reason: "no_queued_jobs" });
  }

  const { error: claimError } = await supabase
    .from("ingest_job")
    .update({ status: "running" })
    .eq("id", queuedJob.id)
    .eq("status", "queued");

  if (claimError) {
    return NextResponse.json({ ok: false, error: "job_claim_failed", details: claimError.message }, { status: 500 });
  }

  // NOTE: Token-backed Gmail fetch execution will be implemented when oauth_connection
  // encrypted token persistence is added. For now, mark as failed with explicit reason
  // so operations can track pipeline completeness.
  const missingCapability = "oauth_connection_token_store_not_implemented";

  const { error: failError } = await supabase
    .from("ingest_job")
    .update({
      status: "failed",
      error: missingCapability,
      payload: {
        ...(queuedJob.payload ?? {}),
        process_attempted_at: new Date().toISOString(),
        process_failure_reason: missingCapability,
      },
    })
    .eq("id", queuedJob.id);

  if (failError) {
    return NextResponse.json({ ok: false, error: "job_fail_update_failed", details: failError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    processed: true,
    jobId: queuedJob.id,
    status: "failed",
    reason: missingCapability,
  });
}
