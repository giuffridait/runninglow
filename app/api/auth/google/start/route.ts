import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { buildGoogleAuthUrl } from "@/lib/auth/google";
import { env } from "@/lib/env";
import { setOAuthState } from "@/lib/auth/session";

export async function GET() {
  const state = randomUUID();
  await setOAuthState(state);

  const authUrl = buildGoogleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    state,
  });

  return NextResponse.redirect(authUrl);
}
