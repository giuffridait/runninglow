import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseKnusprEmail } from "@/lib/parsers/knuspr";

const USER_ID = "00000000-0000-0000-0000-000000000001";

export async function POST(_: Request, { params }: { params: Promise<{ sourceEmailId: string }> }) {
  const { sourceEmailId } = await params;
  const supabase = createSupabaseServerClient();

  const { data: sourceEmail, error } = await supabase
    .from("source_email")
    .select("id,subject,from_address,raw_html")
    .eq("id", sourceEmailId)
    .eq("user_id", USER_ID)
    .maybeSingle();

  if (error || !sourceEmail) {
    return NextResponse.json({ ok: false, error: "source_email_not_found" }, { status: 404 });
  }

  const html = (sourceEmail as { raw_html?: string }).raw_html;
  if (!html) {
    await supabase.from("source_email").update({ parse_status: "failed", parse_error: "missing_raw_html" }).eq("id", sourceEmailId);
    return NextResponse.json({ ok: false, error: "missing_raw_html" }, { status: 400 });
  }

  try {
    const parsed = parseKnusprEmail(html);

    const { data: order, error: orderError } = await supabase
      .from("order")
      .insert({
        user_id: USER_ID,
        merchant_id: 1,
        source_email_id: sourceEmailId,
        order_external_id: parsed.order_external_id,
        order_date: parsed.order_date,
        currency: parsed.currency,
        total_price: parsed.total_price,
      })
      .select("id")
      .single();

    if (orderError || !order) throw new Error(orderError?.message ?? "order_insert_failed");

    if (parsed.items.length > 0) {
      const rows = parsed.items.map((item) => ({
        order_id: order.id,
        raw_name: item.raw_name,
        raw_quantity: item.quantity,
        raw_unit: item.unit,
        line_total: item.line_total,
      }));
      const { error: itemError } = await supabase.from("order_item").insert(rows);
      if (itemError) throw new Error(itemError.message);
    }

    await supabase.from("source_email").update({ parse_status: "parsed", parse_error: null }).eq("id", sourceEmailId);
    return NextResponse.json({ ok: true, orderId: order.id, itemCount: parsed.items.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "parse_failed";
    await supabase.from("source_email").update({ parse_status: "failed", parse_error: message }).eq("id", sourceEmailId);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
