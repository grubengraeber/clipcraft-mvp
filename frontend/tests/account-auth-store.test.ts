import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir = "";

async function useFreshStore() {
  dataDir = await mkdtemp(join(tmpdir(), "clipcraft-test-"));
  process.env.CLIPCRAFT_DATA_DIR = dataDir;
  delete process.env.RESEND_API_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_CREATOR;
  delete process.env.STRIPE_PRICE_STUDIO;
  vi.resetModules();
}

beforeEach(async () => {
  await useFreshStore();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.CLIPCRAFT_DATA_DIR;
  delete process.env.RESEND_API_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_CREATOR;
  delete process.env.STRIPE_PRICE_STUDIO;
  vi.unstubAllGlobals();
});

describe("account-store", () => {
  it("creates an OTP-created account, completes onboarding, activates billing and records usage", async () => {
    const accountStore = await import("@/lib/account-store");

    const initial = await accountStore.ensureAccountForEmail({
      email: "MIRA@EXAMPLE.COM",
      name: "Mira",
    });

    expect(initial.email).toBe("mira@example.com");
    expect(initial.onboardingCompletedAt).toBeNull();
    expect(accountStore.accountHasAccess(initial)).toBe(false);

    const onboarded = await accountStore.upsertAccount({
      name: "Mira Schaefer",
      email: "mira@example.com",
      workspaceName: "Mira Studio",
      role: "Creator",
      primaryGoal: "Batch Export",
      brandAccent: "#ff4d2e",
      planId: "studio",
    });
    expect(onboarded.onboardingCompletedAt).toEqual(expect.any(String));
    expect(onboarded.billing.planId).toBe("studio");

    const active = await accountStore.activateLocalPlan("studio");
    expect(active.billing.status).toBe("active");
    expect(active.billing.provider).toBe("local");
    expect(accountStore.accountHasAccess(active)).toBe(true);

    const used = await accountStore.recordUsage(3.5, 2);
    expect(used?.usage.monthlyMinutesUsed).toBe(3.5);
    expect(used?.usage.monthlyExports).toBe(2);
  });

  it("detects Stripe config and applies price ids", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_CREATOR = "price_creator";
    process.env.STRIPE_PRICE_STUDIO = "price_studio";
    vi.resetModules();
    const accountStore = await import("@/lib/account-store");

    expect(accountStore.isStripeConfigured()).toBe(true);
    expect(accountStore.getStripePriceId("studio")).toBe("price_studio");
    expect(accountStore.getPlan("creator").minutes).toBe(120);
  });

  it("updates an existing OTP account and handles local billing without a profile", async () => {
    const accountStore = await import("@/lib/account-store");

    const created = await accountStore.ensureAccountForEmail({
      email: "first@example.com",
      name: "First User",
    });
    const updated = await accountStore.ensureAccountForEmail({
      email: "SECOND@EXAMPLE.COM",
      name: "Second User",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.email).toBe("second@example.com");
    expect(updated.name).toBe("Second User");

    await rm(dataDir, { recursive: true, force: true });
    const anonymous = await accountStore.activateLocalPlan("creator");
    expect(anonymous.email).toBe("");
    expect(anonymous.billing.status).toBe("active");
    expect(await accountStore.recordUsage(1)).not.toBeNull();
  });

  it("tracks Stripe checkout, activation and subscription status updates", async () => {
    const accountStore = await import("@/lib/account-store");

    const pending = await accountStore.markStripeCheckoutPending({
      planId: "studio",
      checkoutSessionId: "cs_test_123",
      customerId: "cus_123",
    });
    expect(pending.billing.status).toBe("pending");
    expect(pending.billing.provider).toBe("stripe");
    expect(pending.billing.stripeCustomerId).toBe("cus_123");

    const active = await accountStore.activateStripePlan({
      subscriptionId: "sub_123",
      currentPeriodEnd: "2026-06-01T00:00:00.000Z",
    });
    expect(active.billing.status).toBe("active");
    expect(active.billing.stripeSubscriptionId).toBe("sub_123");

    const unchangedActivation = await accountStore.activateStripePlan({});
    expect(unchangedActivation.billing.planId).toBe("studio");
    expect(unchangedActivation.billing.stripeCheckoutSessionId).toBe("cs_test_123");
    expect(unchangedActivation.billing.currentPeriodEnd).toBe(
      "2026-06-01T00:00:00.000Z",
    );

    const ignored = await accountStore.updateStripeSubscriptionStatus({
      status: "canceled",
      customerId: "cus_other",
      subscriptionId: "sub_other",
    });
    expect(ignored?.billing.status).toBe("active");

    const pastDue = await accountStore.updateStripeSubscriptionStatus({
      status: "past_due",
      subscriptionId: "sub_123",
      currentPeriodEnd: "2026-06-15T00:00:00.000Z",
    });
    expect(pastDue?.billing.status).toBe("past_due");
    expect(pastDue?.billing.currentPeriodEnd).toBe("2026-06-15T00:00:00.000Z");

    const canceled = await accountStore.updateStripeSubscriptionStatus({
      status: "canceled",
    });
    expect(canceled?.billing.stripeSubscriptionId).toBe("sub_123");
    expect(canceled?.billing.currentPeriodEnd).toBe("2026-06-15T00:00:00.000Z");
  });

  it("normalizes partially persisted account data", async () => {
    const accountStore = await import("@/lib/account-store");
    const account = await accountStore.upsertAccount({
      name: "",
      email: "legacy@example.com",
      workspaceName: "",
      role: "",
      primaryGoal: "",
      brandAccent: "",
      planId: "studio",
    });

    expect(account.name).toBe("ClipCraft User");
    expect(account.workspaceName).toBe("ClipCraft Studio");
    expect(account.role).toBe("creator");
    expect(account.primaryGoal).toBe("thumbnails");
    expect(account.brandAccent).toBe("#ff4d2e");

    const accountPath = join(dataDir, "account.json");
    await writeFile(
      accountPath,
      JSON.stringify({
        ...account,
        billing: { planId: "unknown" },
        usage: null,
      }),
      "utf8",
    );

    const normalized = await accountStore.readAccount();
    expect(normalized?.billing.planId).toBe("creator");
    expect(normalized?.billing.status).toBe("not_started");
    expect(normalized?.usage.monthlyExports).toBe(0);
  });

  it("returns null for usage and Stripe status updates before an account exists", async () => {
    const accountStore = await import("@/lib/account-store");

    await expect(accountStore.recordUsage(2, 1)).resolves.toBeNull();
    await expect(
      accountStore.updateStripeSubscriptionStatus({ status: "active" }),
    ).resolves.toBeNull();
  });
});

describe("auth-store", () => {
  it("requests a dev OTP, rejects wrong codes and creates/deletes sessions", async () => {
    const authStore = await import("@/lib/auth-store");

    const request = await authStore.requestOtp("mira@example.com");
    expect(request.delivery).toBe("dev");
    expect(request.devOtp).toMatch(/^\d{6}$/);

    await expect(authStore.verifyOtp("mira@example.com", "000000")).resolves.toMatchObject({
      ok: false,
      reason: "mismatch",
    });

    await expect(
      authStore.verifyOtp("mira@example.com", request.devOtp ?? ""),
    ).resolves.toMatchObject({ ok: true, email: "mira@example.com" });

    const { token, session } = await authStore.createSession({
      accountId: "account_1",
      email: "mira@example.com",
    });
    expect(session.accountId).toBe("account_1");
    await expect(authStore.readSession(token)).resolves.toMatchObject({
      email: "mira@example.com",
    });

    await authStore.deleteSession(token);
    await expect(authStore.readSession(token)).resolves.toBeNull();
  });

  it("rejects invalid OTP inputs without mutating sessions", async () => {
    const authStore = await import("@/lib/auth-store");

    await expect(authStore.verifyOtp("", "")).resolves.toMatchObject({
      ok: false,
      reason: "invalid",
    });
    await expect(authStore.verifyOtp("nobody@example.com", "123456")).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("expires, locks and clears auth state", async () => {
    const authStore = await import("@/lib/auth-store");

    await expect(authStore.readSession(null)).resolves.toBeNull();
    await expect(authStore.readSession("missing")).resolves.toBeNull();
    await expect(authStore.deleteSession(null)).resolves.toBeUndefined();

    const request = await authStore.requestOtp("locked@example.com");
    for (let index = 0; index < 5; index += 1) {
      await expect(authStore.verifyOtp("locked@example.com", "111111")).resolves.toMatchObject({
        ok: false,
        reason: "mismatch",
      });
    }
    await expect(
      authStore.verifyOtp("locked@example.com", request.devOtp ?? ""),
    ).resolves.toMatchObject({ ok: false, reason: "locked" });

    const expiredRequest = await authStore.requestOtp("expired@example.com");
    const authPath = join(dataDir, "auth.json");
    const state = JSON.parse(await readFile(authPath, "utf8"));
    state.otps = state.otps.map((otp: { email: string }) =>
      otp.email === expiredRequest.email
        ? { ...otp, expiresAt: "2000-01-01T00:00:00.000Z" }
        : otp,
    );
    await writeFile(authPath, JSON.stringify(state, null, 2), "utf8");
    await expect(
      authStore.verifyOtp("expired@example.com", expiredRequest.devOtp ?? ""),
    ).resolves.toMatchObject({ ok: false, reason: "expired" });

    const { token } = await authStore.createSession({
      accountId: "account_expired",
      email: "expired@example.com",
    });
    const sessionState = JSON.parse(await readFile(authPath, "utf8"));
    sessionState.sessions = sessionState.sessions.map((session: { accountId: string }) =>
      session.accountId === "account_expired"
        ? { ...session, expiresAt: "2000-01-01T00:00:00.000Z" }
        : session,
    );
    await writeFile(authPath, JSON.stringify(sessionState, null, 2), "utf8");
    await expect(authStore.readSession(token)).resolves.toBeNull();

    await authStore.clearAuthStateForTests();
    const cleared = JSON.parse(await readFile(authPath, "utf8"));
    expect(cleared).toEqual({ otps: [], sessions: [] });
  });

  it("sends OTP email through Resend and surfaces provider failures", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    const authStore = await import("@/lib/auth-store");

    const result = await authStore.requestOtp("mail@example.com");
    expect(result.delivery).toBe("email");
    expect(result.devOtp).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test",
        }),
      }),
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: "provider down" }),
    });
    await expect(authStore.requestOtp("fail@example.com")).rejects.toThrow(
      "provider down",
    );
  });
});
