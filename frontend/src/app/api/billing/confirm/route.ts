import { NextResponse } from "next/server";

import {
  activateStripePlan,
  getStripePriceId,
  type PlanId,
} from "@/lib/account-store";
import { apiErrorResponse } from "@/lib/api-responses";
import { requireSessionAccount } from "@/lib/auth-session";
import { getMessages, getRequestLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfirmRequest = {
  sessionId?: string;
};

export async function POST(request: Request) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    const { sessionId } = (await request.json()) as ConfirmRequest;
    if (!sessionId) {
      return NextResponse.json(
        { error: copy.checkoutMissingSession },
        { status: 400 },
      );
    }

    const { account } = await requireSessionAccount();

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ account });
    }

    const params = new URLSearchParams();
    params.set("expand[]", "subscription");

    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        sessionId,
      )}?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        },
      },
    );
    const session = (await response.json()) as {
      id: string;
      status?: string;
      payment_status?: string;
      customer?: string | null;
      metadata?: { plan_id?: string; account_id?: string };
      subscription?:
        | string
        | {
            id?: string;
            current_period_end?: number;
          }
        | null;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(
        session.error?.message ?? copy.checkoutRead,
      );
    }

    if (
      session.status !== "complete" ||
      !["paid", "no_payment_required"].includes(session.payment_status ?? "")
    ) {
      return NextResponse.json({ account });
    }

    const planId = normalizePlanId(session.metadata?.plan_id);
    const subscription =
      typeof session.subscription === "object" ? session.subscription : null;
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : subscription?.id ?? null;

    const updated = await activateStripePlan({
      planId,
      checkoutSessionId: session.id,
      customerId: session.customer ?? null,
      subscriptionId,
      currentPeriodEnd: subscription?.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
    });

    return NextResponse.json({ account: updated });
  } catch (error) {
    return apiErrorResponse(error, copy.checkoutConfirm, 500, locale);
  }
}

function normalizePlanId(value: unknown): PlanId {
  if (value === "studio") return "studio";
  if (getStripePriceId("studio") && value === getStripePriceId("studio")) {
    return "studio";
  }
  return "creator";
}
