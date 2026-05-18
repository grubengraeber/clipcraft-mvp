import { NextResponse } from "next/server";

import { requestOtp } from "@/lib/auth-store";
import { getMessages, getRequestLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    const body = (await request.json()) as { email?: string };
    const result = await requestOtp(body.email ?? "", locale);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : copy.otpSend,
      },
      { status: 400 },
    );
  }
}
