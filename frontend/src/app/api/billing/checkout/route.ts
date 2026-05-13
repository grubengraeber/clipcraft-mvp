import { NextResponse } from "next/server";

import {
  activateLocalPlan,
  getStripePriceId,
  isStripeConfigured,
  markStripeCheckoutPending,
  type OnboardingInput,
  type PlanId,
  upsertAccount,
} from "@/lib/account-store";
import { apiErrorResponse } from "@/lib/api-responses";
import { requireSessionAccount } from "@/lib/auth-session";
import { getMessages, getRequestLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutRequest = {
  planId?: PlanId;
  demo?: boolean;
  account?: OnboardingInput;
};

export async function POST(request: Request) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    const body = (await request.json()) as CheckoutRequest;
    const planId = body.planId === "studio" ? "studio" : "creator";
    const { account: sessionAccount } = await requireSessionAccount();

    const account = body.account
      ? await upsertAccount({
          ...body.account,
          email: sessionAccount.email || body.account.email,
          planId,
        })
      : sessionAccount;

    const priceId = getStripePriceId(planId);
    if (body.demo || !isStripeConfigured() || !priceId) {
      const updated = await activateLocalPlan(planId);
      return NextResponse.json({
        mode: "local",
        account: updated,
      });
    }

    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.APP_URL ??
      request.headers.get("origin") ??
      new URL(request.url).origin;
    const successUrl = `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/?checkout=cancelled`;

    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("ui_mode", "hosted");
    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);
    params.set("client_reference_id", account.id);
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    params.set("allow_promotion_codes", "true");
    params.set("metadata[account_id]", account.id);
    params.set("metadata[plan_id]", planId);
    params.set("subscription_data[metadata][account_id]", account.id);
    params.set("subscription_data[metadata][plan_id]", planId);
    if (account.email) {
      params.set("customer_email", account.email);
    }

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const session = (await response.json()) as {
      id?: string;
      url?: string;
      customer?: string | null;
      error?: { message?: string };
    };

    if (!response.ok || !session.id || !session.url) {
      throw new Error(
        session.error?.message ?? copy.checkoutStartStripe,
      );
    }

    await markStripeCheckoutPending({
      planId,
      checkoutSessionId: session.id,
      customerId: session.customer ?? null,
    });

    return NextResponse.json({
      mode: "stripe",
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    return apiErrorResponse(error, copy.checkoutPrepare, 500, locale);
  }
}
