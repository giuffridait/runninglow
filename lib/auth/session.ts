import { cookies } from "next/headers";

export const AUTH_STATE_COOKIE = "google_oauth_state";
export const GMAIL_CONNECTION_COOKIE = "gmail_connected";

export type GmailConnection = {
  provider: "google";
  scope: string;
  expiresAt: string;
  connectedAt: string;
};

export async function setOAuthState(state: string) {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
}

export async function getOAuthState() {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_STATE_COOKIE)?.value;
}

export async function clearOAuthState() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_STATE_COOKIE);
}

export async function setGmailConnection(connection: GmailConnection) {
  const cookieStore = await cookies();
  cookieStore.set(GMAIL_CONNECTION_COOKIE, JSON.stringify(connection), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearGmailConnection() {
  const cookieStore = await cookies();
  cookieStore.delete(GMAIL_CONNECTION_COOKIE);
}

export async function getGmailConnection(): Promise<GmailConnection | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(GMAIL_CONNECTION_COOKIE)?.value;
  if (!raw) return null;

  try {
    return JSON.parse(raw) as GmailConnection;
  } catch {
    return null;
  }
}
