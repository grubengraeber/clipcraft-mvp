import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  activateStripePlan,
  type BillingStatus,
  type PlanId,
  updateStripeSubscriptionStatus,
} from "@/lib/account-store";
import { getMessages, getRequestLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripeEvent = {
  type: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

export async function POST(request: Request) {
  const copy = getMessages(getRequestLocale(request)).api;
  const body = await request.text();

  if (process.env.STRIPE_WEBHOOK_SECRET) {
    const signature = request.headers.get("stripe-signature");
    if (
      !signature ||
      !verifyStripeSignature(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      )
    ) {
      return NextResponse.json(
        { error: copy.webhookSignature },
        { status: 400 },
      );
    }
  }

  const event = JSON.parse(body) as StripeEvent;
  const object = event.data?.object ?? {};

  if (event.type === "checkout.session.completed") {
    await activateStripePlan({
      planId: normalizePlanId(object.metadata),
      checkoutSessionId: readString(object.id),
      customerId: readString(object.customer),
      subscriptionId: readString(object.subscription),
    });
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await updateStripeSubscriptionStatus({
      status:
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : normalizeSubscriptionStatus(readString(object.status)),
      customerId: readString(object.customer),
      subscriptionId: readString(object.id),
      currentPeriodEnd: readNumber(object.current_period_end)
        ? new Date(readNumber(object.current_period_end) * 1000).toISOString()
        : null,
    });
  }

  return NextResponse.json({ received: true });
}

function verifyStripeSignature(
  body: string,
  header: string,
  secret: string,
) {
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...value] = part.split("=");
      return [key, value.join("=")];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function normalizePlanId(metadata: unknown): PlanId | undefined {
  const planId =
    metadata && typeof metadata === "object" && "plan_id" in metadata
      ? (metadata as { plan_id?: unknown }).plan_id
      : undefined;
  if (planId === "creator" || planId === "studio") return planId;
  return undefined;
}

function normalizeSubscriptionStatus(value: string | null): BillingStatus {
  if (value === "active" || value === "trialing" || value === "past_due") {
    return value;
  }
  if (value === "canceled" || value === "unpaid" || value === "incomplete_expired") {
    return "canceled";
  }
  return "pending";
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}
