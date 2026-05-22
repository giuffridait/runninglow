import { env } from "@/lib/env";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <h1 className="text-3xl font-semibold">Runninglow</h1>
      <p className="text-slate-700">
        Personal AI-powered household replenishment assistant.
      </p>
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
