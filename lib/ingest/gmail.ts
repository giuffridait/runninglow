const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export const MERCHANT_GMAIL_QUERY = "(from:(knuspr.de OR zooplus.de) subject:(Bestellung OR order OR Rechnung))";

export type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type GmailMessageMetadata = {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
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
  if (params.pageToken) {
    url.searchParams.set("pageToken", params.pageToken);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Gmail list failed: ${response.status}`);
  }

  return (await response.json()) as GmailListResponse;
}

export async function getGmailMessageMetadata(params: { accessToken: string; messageId: string }) {
  const url = new URL(`${GMAIL_API_BASE}/${params.messageId}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.set("metadataHeaders", "Subject");
  url.searchParams.set("metadataHeaders", "From");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Gmail get metadata failed: ${response.status}`);
  }

  return (await response.json()) as GmailMessageMetadata;
}

export function extractHeader(message: GmailMessageMetadata, headerName: string) {
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === headerName.toLowerCase())?.value;
}
