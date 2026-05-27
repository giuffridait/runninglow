import { NextResponse } from "next/server";
import { exchangeGoogleCode } from "@/lib/auth/google";
import { clearOAuthState, getOAuthState, setGmailConnection } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { upsertGoogleOAuthConnection } from "@/lib/auth/oauth-connection";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/?auth=error`);
  }

  const expectedState = await getOAuthState();
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/?auth=invalid_state`);
  }

  if (!code) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/?auth=missing_code`);
  }

  try {
    const tokens = await exchangeGoogleCode({
      code,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    });

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await upsertGoogleOAuthConnection({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scope: tokens.scope,
    });

    await setGmailConnection({
      provider: "google",
      scope: tokens.scope,
      expiresAt,
      connectedAt: new Date().toISOString(),
    });
    await clearOAuthState();

    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/?auth=connected`);
  } catch {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/?auth=token_exchange_failed`);
  }
}
