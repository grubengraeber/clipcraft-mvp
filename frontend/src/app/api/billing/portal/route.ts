import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api-responses";
import { requireSessionAccount } from "@/lib/auth-session";
import { getMessages, getRequestLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    const { account } = await requireSessionAccount();

    if (
      account.billing.provider !== "stripe" ||
      !account.billing.stripeCustomerId ||
      !process.env.STRIPE_SECRET_KEY
    ) {
      return NextResponse.json({
        mode: "local",
        message: copy.localSubscription,
      });
    }

    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.APP_URL ??
      request.headers.get("origin") ??
      new URL(request.url).origin;

    const params = new URLSearchParams();
    params.set("customer", account.billing.stripeCustomerId);
    params.set("return_url", origin);

    const response = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    const session = (await response.json()) as {
      url?: string;
      error?: { message?: string };
    };

    if (!response.ok || !session.url) {
      throw new Error(
        session.error?.message ?? copy.billingPortalOpen,
      );
    }

    return NextResponse.json({
      mode: "stripe",
      url: session.url,
    });
  } catch (error) {
    return apiErrorResponse(error, copy.billingPortalOpen, 500, locale);
  }
}
