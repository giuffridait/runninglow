import Link from "next/link";
import { env } from "@/lib/env";
import { getGmailConnection } from "@/lib/auth/session";

type HomeProps = {
  searchParams: Promise<{ auth?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const connection = await getGmailConnection();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <h1 className="text-3xl font-semibold">Runninglow</h1>
      <p className="text-slate-700">Personal AI-powered household replenishment assistant.</p>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-medium">Gmail connection</h2>
        {connection ? (
          <div className="mt-3 space-y-3 text-sm text-slate-700">
            <p>Connected to Google Gmail (read-only).</p>
            <p>Scope: {connection.scope}</p>
            <p>Token expires at: {connection.expiresAt}</p>
            <form action="/api/connections/google/disconnect" method="post">
              <button className="rounded bg-slate-900 px-3 py-2 text-white" type="submit">
                Disconnect Gmail
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-3">
            <Link className="rounded bg-slate-900 px-3 py-2 text-white" href="/api/auth/google/start">
              Connect Gmail
            </Link>
          </div>
        )}
        {params.auth ? <p className="mt-3 text-xs text-slate-500">Auth status: {params.auth}</p> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-medium">Environment status</h2>
        <ul className="mt-2 list-disc pl-6 text-sm text-slate-700">
          <li>NEXT_PUBLIC_APP_URL: {env.NEXT_PUBLIC_APP_URL}</li>
          <li>Supabase URL configured: {env.NEXT_PUBLIC_SUPABASE_URL ? "yes" : "no"}</li>
          <li>Supabase anon key configured: {env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "yes" : "no"}</li>
        </ul>
      </section>
    </main>
  );
}
