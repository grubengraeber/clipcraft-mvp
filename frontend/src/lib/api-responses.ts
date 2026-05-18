import { NextResponse } from "next/server";

import { isAuthRequiredError } from "@/lib/auth-session";
import { DEFAULT_LOCALE, getMessages, type Locale } from "@/lib/i18n";

export function apiErrorResponse(
  error: unknown,
  fallback: string,
  status = 500,
  locale: Locale = DEFAULT_LOCALE,
) {
  if (isAuthRequiredError(error)) {
    return NextResponse.json(
      { error: getMessages(locale).api.authRequired },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : fallback,
    },
    { status },
  );
}
