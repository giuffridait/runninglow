import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decryptString, encryptString } from "@/lib/auth/crypto";

const BOOTSTRAP_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function upsertGoogleOAuthConnection(input: {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope: string;
}) {
  const supabase = createSupabaseServerClient();
  const payload = {
    user_id: BOOTSTRAP_USER_ID,
    provider: "google",
    scope: input.scope,
    encrypted_access_token: encryptString(input.accessToken),
    encrypted_refresh_token: input.refreshToken ? encryptString(input.refreshToken) : null,
    expires_at: input.expiresAt ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("oauth_connection")
    .upsert(payload, { onConflict: "user_id,provider" });

  if (error) throw new Error(`oauth_upsert_failed:${error.message}`);
}

export async function getGoogleOAuthConnection() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("oauth_connection")
    .select("encrypted_access_token,encrypted_refresh_token,expires_at,scope")
    .eq("user_id", BOOTSTRAP_USER_ID)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error(`oauth_select_failed:${error.message}`);
  if (!data) return null;
  return {
    accessToken: decryptString(data.encrypted_access_token),
    refreshToken: data.encrypted_refresh_token ? decryptString(data.encrypted_refresh_token) : undefined,
    expiresAt: data.expires_at as string | null,
    scope: data.scope as string,
  };
}
