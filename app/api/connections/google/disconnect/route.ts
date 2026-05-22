import { NextResponse } from "next/server";
import { clearGmailConnection } from "@/lib/auth/session";

export async function POST() {
  await clearGmailConnection();
  return NextResponse.json({ ok: true });
}
