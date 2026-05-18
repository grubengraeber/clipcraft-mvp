import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PlanId = "creator" | "studio";

export type BillingStatus =
  | "not_started"
  | "pending"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled";

export type BillingProvider = "local" | "stripe" | null;

export type ClipCraftPlan = {
  id: PlanId;
  name: string;
  priceLabel: string;
  minutes: number;
  exports: number;
  stripePriceEnv: string;
};

export type StoredAccount = {
  id: string;
  name: string;
  email: string;
  workspaceName: string;
  role: string;
  primaryGoal: string;
  brandAccent: string;
  createdAt: string;
  updatedAt: string;
  onboardingCompletedAt: string | null;
  billing: {
    status: BillingStatus;
    provider: BillingProvider;
    planId: PlanId;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripeCheckoutSessionId: string | null;
    currentPeriodEnd: string | null;
    updatedAt: string;
  };
  usage: {
    monthlyMinutesUsed: number;
    monthlyExports: number;
    periodStart: string;
  };
};

export type OnboardingInput = {
  name: string;
  email: string;
  workspaceName: string;
  role: string;
  primaryGoal: string;
  brandAccent: string;
  planId: PlanId;
};

export const CLIPCRAFT_PLANS: ClipCraftPlan[] = [
  {
    id: "creator",
    name: "Creator",
    priceLabel: "19 EUR / Monat",
    minutes: 120,
    exports: 250,
    stripePriceEnv: "STRIPE_PRICE_CREATOR",
  },
  {
    id: "studio",
    name: "Studio",
    priceLabel: "49 EUR / Monat",
    minutes: 600,
    exports: 2000,
    stripePriceEnv: "STRIPE_PRICE_STUDIO",
  },
];

function getDataDir() {
  return process.env.CLIPCRAFT_DATA_DIR ?? join(process.cwd(), ".clipcraft-data");
}

function getAccountPath() {
  return join(getDataDir(), "account.json");
}

export function getPlan(planId: PlanId) {
  return (
    CLIPCRAFT_PLANS.find((plan) => plan.id === planId) ?? CLIPCRAFT_PLANS[0]
  );
}

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && getStripePriceId("creator"));
}

export function getStripePriceId(planId: PlanId) {
  const plan = getPlan(planId);
  return process.env[plan.stripePriceEnv] ?? process.env.STRIPE_PRICE_ID ?? "";
}

export function accountHasAccess(account: StoredAccount | null) {
  return Boolean(
    account?.onboardingCompletedAt &&
      (account.billing.status === "active" ||
        account.billing.status === "trialing"),
  );
}

export async function readAccount(): Promise<StoredAccount | null> {
  await ensureStore();

  try {
    const content = await readFile(getAccountPath(), "utf8");
    const parsed = JSON.parse(content) as StoredAccount;
    return normalizeAccount(parsed);
  } catch {
    return null;
  }
}

export async function ensureAccountForEmail(input: {
  email: string;
  name?: string;
  workspaceName?: string;
}) {
  const current = await readAccount();
  const now = new Date().toISOString();
  const email = cleanEmail(input.email);
  const name = cleanText(input.name ?? "");
  const workspaceName = cleanText(input.workspaceName ?? "");

  if (current) {
    const updated: StoredAccount = {
      ...current,
      email: email || current.email,
      name: name || current.name,
      workspaceName: workspaceName || current.workspaceName,
      updatedAt: now,
    };
    await writeAccount(updated);
    return updated;
  }

  const account: StoredAccount = {
    id: randomUUID(),
    name: name || "ClipCraft User",
    email,
    workspaceName: workspaceName || (name ? `${name} Studio` : "ClipCraft Studio"),
    role: "creator",
    primaryGoal: "thumbnails",
    brandAccent: "#ff4d2e",
    createdAt: now,
    updatedAt: now,
    onboardingCompletedAt: null,
    billing: {
      status: "not_started",
      provider: null,
      planId: "creator",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      currentPeriodEnd: null,
      updatedAt: now,
    },
    usage: {
      monthlyMinutesUsed: 0,
      monthlyExports: 0,
      periodStart: now,
    },
  };

  await writeAccount(account);
  return account;
}

export async function upsertAccount(input: OnboardingInput) {
  const current = await readAccount();
  const now = new Date().toISOString();
  const planId = normalizePlanId(input.planId);

  const account: StoredAccount = {
    id: current?.id ?? randomUUID(),
    name: cleanText(input.name) || "ClipCraft User",
    email: cleanEmail(input.email),
    workspaceName:
      cleanText(input.workspaceName) ||
      `${cleanText(input.name) || "ClipCraft"} Studio`,
    role: cleanText(input.role) || "creator",
    primaryGoal: cleanText(input.primaryGoal) || "thumbnails",
    brandAccent: cleanText(input.brandAccent) || "#ff4d2e",
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    onboardingCompletedAt: now,
    billing: {
      status: current?.billing.status ?? "not_started",
      provider: current?.billing.provider ?? null,
      planId,
      stripeCustomerId: current?.billing.stripeCustomerId ?? null,
      stripeSubscriptionId: current?.billing.stripeSubscriptionId ?? null,
      stripeCheckoutSessionId:
        current?.billing.stripeCheckoutSessionId ?? null,
      currentPeriodEnd: current?.billing.currentPeriodEnd ?? null,
      updatedAt: now,
    },
    usage: current?.usage ?? {
      monthlyMinutesUsed: 0,
      monthlyExports: 0,
      periodStart: now,
    },
  };

  await writeAccount(account);
  return account;
}

export async function activateLocalPlan(planId: PlanId) {
  const current = await readAccount();
  const now = new Date().toISOString();
  const account = current ?? buildAnonymousAccount(planId, now);

  const updated: StoredAccount = {
    ...account,
    updatedAt: now,
    onboardingCompletedAt: account.onboardingCompletedAt ?? now,
    billing: {
      ...account.billing,
      status: "active",
      provider: "local",
      planId,
      stripeCheckoutSessionId: null,
      currentPeriodEnd: addMonths(now, 1),
      updatedAt: now,
    },
  };

  await writeAccount(updated);
  return updated;
}

export async function markStripeCheckoutPending(input: {
  planId: PlanId;
  checkoutSessionId: string;
  customerId?: string | null;
}) {
  const current = await readAccount();
  const now = new Date().toISOString();
  const account = current ?? buildAnonymousAccount(input.planId, now);

  const updated: StoredAccount = {
    ...account,
    updatedAt: now,
    onboardingCompletedAt: account.onboardingCompletedAt ?? now,
    billing: {
      ...account.billing,
      status: "pending",
      provider: "stripe",
      planId: input.planId,
      stripeCheckoutSessionId: input.checkoutSessionId,
      stripeCustomerId:
        input.customerId ?? account.billing.stripeCustomerId ?? null,
      updatedAt: now,
    },
  };

  await writeAccount(updated);
  return updated;
}

export async function activateStripePlan(input: {
  planId?: PlanId;
  checkoutSessionId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}) {
  const current = await readAccount();
  const now = new Date().toISOString();
  const account = current ?? buildAnonymousAccount(input.planId ?? "creator", now);

  const updated: StoredAccount = {
    ...account,
    updatedAt: now,
    onboardingCompletedAt: account.onboardingCompletedAt ?? now,
    billing: {
      ...account.billing,
      status: "active",
      provider: "stripe",
      planId: input.planId ?? account.billing.planId,
      stripeCheckoutSessionId:
        input.checkoutSessionId ?? account.billing.stripeCheckoutSessionId,
      stripeCustomerId: input.customerId ?? account.billing.stripeCustomerId,
      stripeSubscriptionId:
        input.subscriptionId ?? account.billing.stripeSubscriptionId,
      currentPeriodEnd:
        input.currentPeriodEnd ?? account.billing.currentPeriodEnd,
      updatedAt: now,
    },
  };

  await writeAccount(updated);
  return updated;
}

export async function updateStripeSubscriptionStatus(input: {
  status: BillingStatus;
  customerId?: string | null;
  subscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}) {
  const account = await readAccount();
  if (!account) return null;

  const customerMatches =
    !input.customerId || input.customerId === account.billing.stripeCustomerId;
  const subscriptionMatches =
    !input.subscriptionId ||
    input.subscriptionId === account.billing.stripeSubscriptionId;

  if (!customerMatches && !subscriptionMatches) return account;

  const now = new Date().toISOString();
  const updated: StoredAccount = {
    ...account,
    updatedAt: now,
    billing: {
      ...account.billing,
      status: input.status,
      provider: "stripe",
      stripeCustomerId: input.customerId ?? account.billing.stripeCustomerId,
      stripeSubscriptionId:
        input.subscriptionId ?? account.billing.stripeSubscriptionId,
      currentPeriodEnd:
        input.currentPeriodEnd ?? account.billing.currentPeriodEnd,
      updatedAt: now,
    },
  };

  await writeAccount(updated);
  return updated;
}

export async function recordUsage(minutes: number, exports = 0) {
  const account = await readAccount();
  if (!account) return null;

  const now = new Date().toISOString();
  const updated: StoredAccount = {
    ...account,
    updatedAt: now,
    usage: {
      ...account.usage,
      monthlyMinutesUsed:
        account.usage.monthlyMinutesUsed + Math.max(0, minutes),
      monthlyExports: account.usage.monthlyExports + Math.max(0, exports),
    },
  };

  await writeAccount(updated);
  return updated;
}

async function ensureStore() {
  await mkdir(getDataDir(), { recursive: true });
}

async function writeAccount(account: StoredAccount) {
  await ensureStore();
  const accountPath = getAccountPath();
  const tempPath = `${accountPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(account, null, 2), "utf8");
  await rename(tempPath, accountPath);
}

function normalizeAccount(account: StoredAccount): StoredAccount {
  const now = new Date().toISOString();
  const planId = normalizePlanId(account.billing?.planId);

  return {
    ...account,
    billing: {
      status: account.billing?.status ?? "not_started",
      provider: account.billing?.provider ?? null,
      planId,
      stripeCustomerId: account.billing?.stripeCustomerId ?? null,
      stripeSubscriptionId: account.billing?.stripeSubscriptionId ?? null,
      stripeCheckoutSessionId:
        account.billing?.stripeCheckoutSessionId ?? null,
      currentPeriodEnd: account.billing?.currentPeriodEnd ?? null,
      updatedAt: account.billing?.updatedAt ?? now,
    },
    usage: account.usage ?? {
      monthlyMinutesUsed: 0,
      monthlyExports: 0,
      periodStart: now,
    },
  };
}

function buildAnonymousAccount(planId: PlanId, now: string): StoredAccount {
  return {
    id: randomUUID(),
    name: "ClipCraft User",
    email: "",
    workspaceName: "ClipCraft Studio",
    role: "creator",
    primaryGoal: "thumbnails",
    brandAccent: "#ff4d2e",
    createdAt: now,
    updatedAt: now,
    onboardingCompletedAt: now,
    billing: {
      status: "not_started",
      provider: null,
      planId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      currentPeriodEnd: null,
      updatedAt: now,
    },
    usage: {
      monthlyMinutesUsed: 0,
      monthlyExports: 0,
      periodStart: now,
    },
  };
}

function normalizePlanId(value: unknown): PlanId {
  return value === "studio" ? "studio" : "creator";
}

function cleanText(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function cleanEmail(value: string) {
  return cleanText(value).toLowerCase().slice(0, 180);
}

function addMonths(isoDate: string, months: number) {
  const date = new Date(isoDate);
  date.setMonth(date.getMonth() + months);
  return date.toISOString();
}
