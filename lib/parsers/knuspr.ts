export type ParsedOrderItem = {
  raw_name: string;
  quantity: number | null;
  unit: string | null;
  line_total: number | null;
};

export type ParsedOrder = {
  merchant: "knuspr";
  order_external_id: string | null;
  order_date: string;
  currency: string;
  total_price: number | null;
  items: ParsedOrderItem[];
};

function parseEuro(value: string): number | null {
  const normalized = value.replace(/\./g, "").replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export function parseKnusprEmail(html: string): ParsedOrder {
  const orderIdMatch = html.match(/Bestell(?:nummer|ung)\s*[:#]?\s*([A-Z0-9\-]+)/i);
  const dateMatch = html.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
  const totalMatch = html.match(/(?:Gesamt|Summe|Total)\s*[:]?\s*([0-9.,]+)\s*€?/i);

  const items: ParsedOrderItem[] = [];
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRegex.exec(html))) {
    const raw_name = row[1].trim();
    const qtyText = row[2].trim();
    const totalText = row[3].trim();
    if (!raw_name || /gesamt|summe|total/i.test(raw_name)) continue;

    const qtyMatch = qtyText.match(/([0-9]+(?:[.,][0-9]+)?)\s*([a-zA-ZäöüÄÖÜ]+)?/);
    const qty = qtyMatch ? Number.parseFloat(qtyMatch[1].replace(",", ".")) : null;
    const unit = qtyMatch?.[2] ?? null;

    items.push({ raw_name, quantity: Number.isFinite(qty as number) ? (qty as number) : null, unit, line_total: parseEuro(totalText) });
  }

  const orderDate = dateMatch ? dateMatch[1] : "1970-01-01";
  const [d, m, y] = orderDate.split(".");

  return {
    merchant: "knuspr",
    order_external_id: orderIdMatch?.[1] ?? null,
    order_date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
    currency: "EUR",
    total_price: totalMatch ? parseEuro(totalMatch[1]) : null,
    items,
  };
}
