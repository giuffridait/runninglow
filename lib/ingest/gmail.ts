const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export const MERCHANT_GMAIL_QUERY = "(from:(knuspr.de OR zooplus.de) subject:(Bestellung OR order OR Rechnung))";

export type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
  };
  snippet?: string;
};

export async function listGmailMessages(params: {
  accessToken: string;
  query?: string;
  pageToken?: string;
  maxResults?: number;
}) {
  const url = new URL(GMAIL_API_BASE);
  url.searchParams.set("q", params.query ?? MERCHANT_GMAIL_QUERY);
  url.searchParams.set("maxResults", String(params.maxResults ?? 50));
  if (params.pageToken) url.searchParams.set("pageToken", params.pageToken);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Gmail list failed: ${response.status}`);
  return (await response.json()) as GmailListResponse;
}

export async function getGmailMessage(params: { accessToken: string; messageId: string }) {
  const url = new URL(`${GMAIL_API_BASE}/${params.messageId}`);
  url.searchParams.set("format", "full");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Gmail get full failed: ${response.status}`);
  return (await response.json()) as GmailMessage;
}

export function extractHeader(message: GmailMessage, headerName: string) {
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === headerName.toLowerCase())?.value;
}

function decodeBase64Url(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

export function extractHtmlBody(message: GmailMessage) {
  if (message.payload?.mimeType === "text/html" && message.payload.body?.data) {
    return decodeBase64Url(message.payload.body.data);
  }
  const htmlPart = message.payload?.parts?.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data);
  return null;
}
