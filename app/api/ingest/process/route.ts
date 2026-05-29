import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractHeader, extractHtmlBody, getGmailMessage, listGmailMessages } from "@/lib/ingest/gmail";
import { getGoogleOAuthConnection, upsertGoogleOAuthConnection } from "@/lib/auth/oauth-connection";
import { env } from "@/lib/env";
import { refreshGoogleAccessToken } from "@/lib/auth/google";
import { parseKnusprEmail } from "@/lib/parsers/knuspr";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function inferMerchant(fromAddress: string | null) {
  if (!fromAddress) return null;
  const f = fromAddress.toLowerCase();
  if (f.includes("knuspr")) return "knuspr";
  if (f.includes("zooplus")) return "zooplus";
  return null;
}

export async function POST() {
  const supabase = createSupabaseServerClient();
  const { data: queuedJob } = await supabase.from("ingest_job").select("id,payload").eq("user_id", USER_ID).eq("job_type", "gmail_fetch").eq("status", "queued").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!queuedJob) return NextResponse.json({ ok: true, processed: false, reason: "no_queued_jobs" });

  await supabase.from("ingest_job").update({ status: "running" }).eq("id", queuedJob.id).eq("status", "queued");

  const conn = await getGoogleOAuthConnection();
  if (!conn) {
    await supabase.from("ingest_job").update({ status: "failed", error: "oauth_connection_missing" }).eq("id", queuedJob.id);
    return NextResponse.json({ ok: false, processed: true, reason: "oauth_connection_missing" }, { status: 400 });
  }

  let accessToken = conn.accessToken;
  let refreshed = false;
  let pageToken: string | undefined;
  let fetched = 0;
  let upserted = 0;
  let parsedOrders = 0;

  try {
    do {
      let page;
      try {
        page = await listGmailMessages({ accessToken, pageToken, query: queuedJob.payload?.query });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "gmail_list_failed";
        if (!refreshed && msg.includes("401") && conn.refreshToken) {
          const t = await refreshGoogleAccessToken({ refreshToken: conn.refreshToken, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET });
          accessToken = t.access_token;
          refreshed = true;
          await upsertGoogleOAuthConnection({ accessToken, refreshToken: conn.refreshToken, expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : undefined, scope: t.scope || conn.scope });
          page = await listGmailMessages({ accessToken, pageToken, query: queuedJob.payload?.query });
        } else throw error;
      }

      const messages = page.messages ?? [];
      fetched += messages.length;

      for (const message of messages) {
        const full = await getGmailMessage({ accessToken, messageId: message.id });
        const subject = extractHeader(full, "subject") ?? null;
        const fromAddress = extractHeader(full, "from") ?? null;
        const receivedAt = full.internalDate ? new Date(Number(full.internalDate)).toISOString() : null;
        const rawHtml = extractHtmlBody(full);
        const merchant = inferMerchant(fromAddress);

        const { error } = await supabase.from("source_email").upsert({
          user_id: USER_ID,
          gmail_message_id: full.id,
          gmail_thread_id: full.threadId,
          received_at: receivedAt,
          subject,
          from_address: fromAddress,
          raw_html: rawHtml,
          parse_status: "pending",
        }, { onConflict: "user_id,gmail_message_id" });
        if (!error) upserted += 1;

        if (merchant === "knuspr" && rawHtml) {
          const parsed = parseKnusprEmail(rawHtml);
          if (parsed.order_external_id) {
            const { data: existing } = await supabase.from("order").select("id").eq("user_id", USER_ID).eq("merchant_id", 1).eq("order_external_id", parsed.order_external_id).maybeSingle();
            if (!existing) {
              const { data: order, error: orderError } = await supabase.from("order").insert({
                user_id: USER_ID, merchant_id: 1, source_email_id: null, order_external_id: parsed.order_external_id, order_date: parsed.order_date, currency: parsed.currency, total_price: parsed.total_price,
              }).select("id").single();
              if (!orderError && order && parsed.items.length > 0) {
                await supabase.from("order_item").insert(parsed.items.map((i) => ({ order_id: order.id, raw_name: i.raw_name, raw_quantity: i.quantity, raw_unit: i.unit, line_total: i.line_total })));
              }
              if (!orderError) parsedOrders += 1;
            }
            await supabase.from("source_email").update({ parse_status: "parsed", parse_error: null }).eq("user_id", USER_ID).eq("gmail_message_id", full.id);
          } else {
            await supabase.from("source_email").update({ parse_status: "failed", parse_error: "missing_order_external_id" }).eq("user_id", USER_ID).eq("gmail_message_id", full.id);
          }
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    await supabase.from("ingest_job").update({ status: "succeeded", payload: { ...(queuedJob.payload ?? {}), fetched, upserted, parsedOrders, refreshed } }).eq("id", queuedJob.id);
    return NextResponse.json({ ok: true, processed: true, jobId: queuedJob.id, fetched, upserted, parsedOrders, refreshed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "ingest_process_failed";
    await supabase.from("ingest_job").update({ status: "failed", error: message }).eq("id", queuedJob.id);
    return NextResponse.json({ ok: false, processed: true, jobId: queuedJob.id, error: message }, { status: 500 });
  }
}
