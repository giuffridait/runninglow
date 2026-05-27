import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGmailConnection } from "@/lib/auth/session";
import { extractHeader, getGmailMessageMetadata, listGmailMessages, MERCHANT_GMAIL_QUERY } from "@/lib/ingest/gmail";

const USER_ID = "00000000-0000-0000-0000-000000000001";

export async function POST() {
  const connection = await getGmailConnection();
  if (!connection?.accessToken) {
    return NextResponse.json({ ok: false, error: "gmail_not_connected" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  const { data: job, error: jobError } = await supabase
    .from("ingest_job")
    .insert({ user_id: USER_ID, job_type: "gmail_fetch", status: "running", payload: { query: MERCHANT_GMAIL_QUERY } })
    .select("id")
    .single();

  if (jobError || !job) {
    return NextResponse.json({ ok: false, error: "job_create_failed", details: jobError?.message }, { status: 500 });
  }

  try {
    let pageToken: string | undefined;
    let fetched = 0;
    let upserted = 0;

    do {
      const page = await listGmailMessages({ accessToken: connection.accessToken, pageToken });
      const messages = page.messages ?? [];
      fetched += messages.length;

      for (const message of messages) {
        const metadata = await getGmailMessageMetadata({ accessToken: connection.accessToken, messageId: message.id });
        const subject = extractHeader(metadata, "subject") ?? null;
        const fromAddress = extractHeader(metadata, "from") ?? null;
        const receivedAt = metadata.internalDate ? new Date(Number(metadata.internalDate)).toISOString() : null;

        const { error } = await supabase.from("source_email").upsert(
          {
            user_id: USER_ID,
            gmail_message_id: metadata.id,
            gmail_thread_id: metadata.threadId,
            received_at: receivedAt,
            subject,
            from_address: fromAddress,
            parse_status: "pending",
          },
          { onConflict: "user_id,gmail_message_id" },
        );

        if (!error) {
          upserted += 1;
        }
      }

      pageToken = page.nextPageToken;
    } while (pageToken);

    await supabase.from("ingest_job").update({ status: "succeeded", payload: { query: MERCHANT_GMAIL_QUERY, fetched, upserted } }).eq("id", job.id);

    return NextResponse.json({ ok: true, jobId: job.id, fetched, upserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    await supabase.from("ingest_job").update({ status: "failed", error: message }).eq("id", job.id);
    return NextResponse.json({ ok: false, error: "ingest_failed", details: message, jobId: job.id }, { status: 500 });
  }
}
