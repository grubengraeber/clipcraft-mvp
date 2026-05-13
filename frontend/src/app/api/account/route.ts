import { NextResponse } from "next/server";

import {
  CLIPCRAFT_PLANS,
  isStripeConfigured,
  type OnboardingInput,
  upsertAccount,
} from "@/lib/account-store";
import { apiErrorResponse } from "@/lib/api-responses";
import { getSessionContext, requireSessionAccount } from "@/lib/auth-session";
import { getMessages, getRequestLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getSessionContext();

  return NextResponse.json({
    authenticated: Boolean(context.account),
    account: context.account,
    billing: {
      stripeConfigured: isStripeConfigured(),
      plans: CLIPCRAFT_PLANS,
    },
  });
}

export async function PUT(request: Request) {
  const locale = getRequestLocale(request);
  try {
    const { account: sessionAccount } = await requireSessionAccount();
    const input = (await request.json()) as OnboardingInput;
    const account = await upsertAccount({
      ...input,
      email: sessionAccount.email || input.email,
    });

    return NextResponse.json({
      authenticated: true,
      account,
      billing: {
        stripeConfigured: isStripeConfigured(),
        plans: CLIPCRAFT_PLANS,
      },
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      getMessages(locale).api.accountSave,
      500,
      locale,
    );
  }
}
