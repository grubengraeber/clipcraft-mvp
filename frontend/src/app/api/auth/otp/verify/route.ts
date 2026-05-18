import { NextResponse } from "next/server";

import { ensureAccountForEmail } from "@/lib/account-store";
import {
  createSession,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  verifyOtp,
} from "@/lib/auth-store";
import { getMessages, getRequestLocale, type Locale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    const body = (await request.json()) as {
      email?: string;
      code?: string;
      name?: string;
      workspaceName?: string;
    };
    const verification = await verifyOtp(body.email ?? "", body.code ?? "");

    if (!verification.ok) {
      return NextResponse.json(
        { error: authErrorMessage(verification.reason, locale) },
        { status: 401 },
      );
    }

    const account = await ensureAccountForEmail({
      email: verification.email,
      name: body.name,
      workspaceName: body.workspaceName,
    });
    const { token, session } = await createSession({
      accountId: account.id,
      email: account.email,
    });
    const response = NextResponse.json({ account, session });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : copy.otpVerify,
      },
      { status: 500 },
    );
  }
}

function authErrorMessage(reason: string, locale: Locale) {
  const copy = getMessages(locale).api;
  if (reason === "expired") return copy.otpExpired;
  if (reason === "locked") return copy.otpLocked;
  return copy.otpWrong;
}
