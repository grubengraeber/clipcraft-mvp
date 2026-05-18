import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth-session";
import { deleteSession, SESSION_COOKIE_NAME } from "@/lib/auth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getSessionContext();

  return NextResponse.json({
    authenticated: Boolean(context.account),
    account: context.account,
    session: context.session,
  });
}

export async function DELETE() {
  const context = await getSessionContext();
  await deleteSession(context.token);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    expires: new Date(0),
    maxAge: 0,
    path: "/",
  });

  return response;
}
