"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CreditCard,
  KeyRound,
  Languages,
  Loader2,
  LockKeyhole,
  Mail,
  Palette,
  Receipt,
  Sparkles,
  UserRound,
} from "lucide-react";

import { ClipCraftStudio } from "@/components/clipcraft-studio";
import type { ClipCraftStudioView } from "@/components/clipcraft-studio";
import type {
  ClipCraftPlan,
  PlanId,
  StoredAccount,
} from "@/lib/account-store";
import {
  DEFAULT_LOCALE,
  getMessages,
  jsonHeaders,
  localeHeader,
  LOCALE_STORAGE_KEY,
  planPriceLabel,
  resolveLocale,
  type Locale,
} from "@/lib/i18n";

type AccountResponse = {
  authenticated?: boolean;
  account: StoredAccount | null;
  billing: {
    stripeConfigured: boolean;
    plans: ClipCraftPlan[];
  };
};

type CheckoutResponse =
  | {
      mode: "stripe";
      url: string;
      sessionId: string;
    }
  | {
      mode: "local";
      account: StoredAccount;
    };

type OtpRequestResponse = {
  email: string;
  expiresAt: string;
  delivery: "email" | "dev";
  devOtp?: string;
  error?: string;
};

type OtpVerifyResponse = {
  account: StoredAccount;
  error?: string;
};

type AuthMode = "login" | "register";

type FormState = {
  name: string;
  email: string;
  workspaceName: string;
  role: string;
  primaryGoal: string;
  brandAccent: string;
  planId: PlanId;
};

type Messages = ReturnType<typeof getMessages>;

const fallbackPlans: ClipCraftPlan[] = [
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

const roleOptions = [
  "Creator",
  "Agentur",
  "Founder",
  "Social Team",
] as const;

const goalOptions = [
  "Thumbnails",
  "Shorts Covers",
  "Batch Export",
  "Auto-cut",
] as const;

const accentOptions = ["#ff4d2e", "#b7ff4a", "#35d7ff", "#ffd166", "#ff6b9a"];

const defaultForm: FormState = {
  name: "",
  email: "",
  workspaceName: "",
  role: roleOptions[0],
  primaryGoal: goalOptions[0],
  brandAccent: accentOptions[0],
  planId: "creator",
};

async function fetchAccountResponse(locale: Locale) {
  const response = await fetch("/api/account", {
    cache: "no-store",
    headers: localeHeader(locale),
  });
  const payload = (await response.json()) as AccountResponse;
  if (!response.ok) {
    throw new Error(getMessages(locale).app.accountLoadError);
  }
  return payload;
}

function getInitialLocale() {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return resolveLocale(
    window.localStorage.getItem(LOCALE_STORAGE_KEY) || navigator.language,
  );
}

function getInitialCheckoutMessage(locale: Locale) {
  if (typeof window === "undefined") return "";

  const checkout = new URL(window.location.href).searchParams.get("checkout");
  return checkout === "cancelled"
    ? getMessages(locale).app.checkoutCancelled
    : "";
}

function getInitialSavingState() {
  if (typeof window === "undefined") return false;

  const url = new URL(window.location.href);
  return Boolean(
    url.searchParams.get("checkout") === "success" &&
      url.searchParams.get("session_id"),
  );
}

export function ClipCraftApp({
  initialAuthMode = "login",
  initialStudioView = "studio",
}: {
  initialAuthMode?: AuthMode;
  initialStudioView?: ClipCraftStudioView;
}) {
  const [locale, setLocale] = useState<Locale>(getInitialLocale);
  const copy = getMessages(locale);
  const [authMode, setAuthMode] = useState<AuthMode>(initialAuthMode);
  const [account, setAccount] = useState<StoredAccount | null>(null);
  const [plans, setPlans] = useState<ClipCraftPlan[]>(fallbackPlans);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [step, setStep] = useState<"profile" | "workflow" | "payment">(
    "profile",
  );
  const [showBilling, setShowBilling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(getInitialSavingState);
  const [message, setMessage] = useState(() =>
    getInitialCheckoutMessage(getInitialLocale()),
  );
  const [error, setError] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerWorkspace, setRegisterWorkspace] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [otpSentTo, setOtpSentTo] = useState("");

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    let active = true;

    async function loadAccount() {
      try {
        const payload = await fetchAccountResponse(locale);
        if (!active) return;

        setAccount(payload.account);
        setPlans(
          payload.billing.plans.length ? payload.billing.plans : fallbackPlans,
        );
        setStripeConfigured(payload.billing.stripeConfigured);
        if (payload.account) {
          setLoginEmail(payload.account.email);
          setForm({
            name: payload.account.name,
            email: payload.account.email,
            workspaceName: payload.account.workspaceName,
            role: payload.account.role,
            primaryGoal: payload.account.primaryGoal,
            brandAccent: payload.account.brandAccent,
            planId: payload.account.billing.planId,
          });
          if (!payload.account.onboardingCompletedAt) {
            setStep("profile");
          } else if (!hasAccess(payload.account)) {
            setStep("payment");
          }
        }
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.app.accountLoadError,
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadAccount();

    return () => {
      active = false;
    };
  }, [copy.app.accountLoadError, locale]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const checkout = url.searchParams.get("checkout");
    const sessionId = url.searchParams.get("session_id");
    if (checkout === "cancelled") {
      window.history.replaceState(null, "", "/");
      return;
    }

    if (checkout !== "success" || !sessionId) return;

    fetch("/api/billing/confirm", {
      method: "POST",
      headers: jsonHeaders(locale),
      body: JSON.stringify({ sessionId }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          | { account: StoredAccount | null }
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : copy.app.checkoutConfirmFailed,
          );
        }
        if ("account" in payload && payload.account) {
          applyAccount(payload.account);
          setStep("payment");
          setShowBilling(false);
          setMessage(copy.app.paymentConfirmed);
        }
      })
      .catch((confirmError) =>
        setError(
          confirmError instanceof Error
            ? confirmError.message
            : copy.app.checkoutConfirmFailed,
        ),
      )
      .finally(() => {
        setSaving(false);
        window.history.replaceState(null, "", "/");
      });
  }, [
    copy.app.checkoutConfirmFailed,
    copy.app.paymentConfirmed,
    locale,
  ]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === form.planId) ?? plans[0],
    [form.planId, plans],
  );
  const access = hasAccess(account);
  const showOnboarding = loading || !access || showBilling;

  function applyAccount(nextAccount: StoredAccount) {
    setAccount(nextAccount);
    setLoginEmail(nextAccount.email);
    setForm({
      name: nextAccount.name,
      email: nextAccount.email,
      workspaceName: nextAccount.workspaceName,
      role: nextAccount.role,
      primaryGoal: nextAccount.primaryGoal,
      brandAccent: nextAccount.brandAccent,
      planId: nextAccount.billing.planId,
    });
    setStep(nextAccount.onboardingCompletedAt ? "payment" : "profile");
  }

  async function requestLoginCode() {
    setError("");
    setMessage("");
    setDevOtp("");

    if (authMode === "register" && !registerName.trim()) {
      setError(copy.app.missingRegistrationName);
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(loginEmail.trim())) {
      setError(copy.app.invalidEmail);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: jsonHeaders(locale),
        body: JSON.stringify({ email: loginEmail }),
      });
      const payload = (await response.json()) as OtpRequestResponse;
      if (!response.ok) {
        throw new Error(payload.error || copy.app.otpSendFailed);
      }

      setOtpSentTo(payload.email);
      setLoginEmail(payload.email);
      setDevOtp(payload.devOtp ?? "");
      setMessage(
        payload.delivery === "email"
          ? authMode === "register"
            ? copy.app.registrationCodeSentEmail
            : copy.app.otpSentEmail
          : authMode === "register"
            ? copy.app.registrationCodeSentDev
            : copy.app.otpSentDev,
      );
    } catch (otpError) {
      setError(
        otpError instanceof Error
          ? otpError.message
          : copy.app.otpSendFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  async function verifyLoginCode() {
    setError("");
    setMessage("");

    if (!otpSentTo) {
      setError(copy.app.otpFirst);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: jsonHeaders(locale),
        body: JSON.stringify({
          email: otpSentTo,
          code: loginCode,
          name: authMode === "register" ? registerName : undefined,
          workspaceName:
            authMode === "register" ? registerWorkspace : undefined,
        }),
      });
      const payload = (await response.json()) as OtpVerifyResponse;
      if (!response.ok) {
        throw new Error(payload.error || copy.app.otpVerifyFailed);
      }

      applyAccount(payload.account);
      setLoginCode("");
      setDevOtp("");
      setMessage(
        authMode === "register"
          ? copy.app.registrationComplete
          : copy.app.signedIn,
      );
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : copy.app.otpVerifyFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setSaving(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } finally {
      setAccount(null);
      setShowBilling(false);
      setStep("profile");
      setForm(defaultForm);
      setAuthMode(initialAuthMode);
      setLoginEmail("");
      setLoginCode("");
      setRegisterName("");
      setRegisterWorkspace("");
      setDevOtp("");
      setOtpSentTo("");
      setMessage("");
      setError("");
      setSaving(false);
    }
  }

  async function saveAccount(nextStep: "workflow" | "payment") {
    setError("");
    setMessage("");

    if (!form.name.trim() || !form.email.trim()) {
      setError(copy.app.missingProfile);
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setError(copy.app.invalidEmail);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/account", {
        method: "PUT",
        headers: jsonHeaders(locale),
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as AccountResponse | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : copy.app.accountSaveFailed,
        );
      }

      const accountPayload = payload as AccountResponse;
      if (accountPayload.account) {
        applyAccount(accountPayload.account);
      }
      setStep(nextStep);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : copy.app.accountSaveFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  async function startCheckout() {
    setError("");
    setMessage("");

    if (!form.name.trim() || !form.email.trim()) {
      setError(copy.app.missingProfile);
      setStep("profile");
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setError(copy.app.invalidEmail);
      setStep("profile");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: jsonHeaders(locale),
        body: JSON.stringify({
          planId: form.planId,
          account: form,
          demo: !stripeConfigured,
        }),
      });
      const payload = (await response.json()) as CheckoutResponse | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : copy.app.checkoutStartFailed,
        );
      }

      if ("mode" in payload && payload.mode === "stripe") {
        window.location.assign(payload.url);
        return;
      }

      if ("mode" in payload && payload.mode === "local") {
        applyAccount(payload.account);
        setShowBilling(false);
        setStep("payment");
        setMessage(copy.app.localPaymentActivated);
      }
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : copy.app.checkoutStartFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  async function openBillingPortal() {
    setError("");
    setMessage("");
    setSaving(true);

    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: localeHeader(locale),
      });
      const payload = (await response.json()) as
        | { mode: "stripe"; url: string }
        | { mode: "local"; message: string }
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : copy.app.billingOpenFailed,
        );
      }

      if ("mode" in payload && payload.mode === "stripe") {
        window.location.assign(payload.url);
        return;
      }

      if ("mode" in payload && payload.mode === "local") {
        setMessage(payload.message);
      }
    } catch (portalError) {
      setError(
        portalError instanceof Error
          ? portalError.message
          : copy.app.billingOpenFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#10110f] text-white">
        <div className="inline-flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin text-[#35d7ff]" />
          {copy.app.loading}
        </div>
      </main>
    );
  }

  if (!account) {
    return (
      <LoginShell
        devOtp={devOtp}
        email={loginEmail}
        error={error}
        message={message}
        mode={authMode}
        onChangeCode={setLoginCode}
        onChangeEmail={setLoginEmail}
        onChangeMode={(mode) => {
          setAuthMode(mode);
          setLoginCode("");
          setDevOtp("");
          setOtpSentTo("");
          setMessage("");
          setError("");
        }}
        onChangeRegisterName={setRegisterName}
        onChangeRegisterWorkspace={setRegisterWorkspace}
        onRequestCode={requestLoginCode}
        onVerifyCode={verifyLoginCode}
        otpSentTo={otpSentTo}
        registerName={registerName}
        registerWorkspace={registerWorkspace}
        saving={saving}
        code={loginCode}
        copy={copy}
        locale={locale}
        onLocaleChange={setLocale}
      />
    );
  }

  return (
    <>
      {showOnboarding ? (
        <OnboardingShell
          account={account}
          copy={copy}
          error={error}
          form={form}
          message={message}
          onBackToStudio={() => setShowBilling(false)}
          onChange={setForm}
          onManageBilling={openBillingPortal}
          onSaveAccount={saveAccount}
          onStartCheckout={startCheckout}
          plans={plans}
          saving={saving}
          selectedPlan={selectedPlan}
          setStep={setStep}
          showBackToStudio={access && showBilling}
          step={step}
          stripeConfigured={stripeConfigured}
          locale={locale}
          onLocaleChange={setLocale}
        />
      ) : (
        <>
          <ClipCraftStudio
            account={account}
            initialView={initialStudioView}
            locale={locale}
            onEditAccount={() => {
              setShowBilling(true);
              setStep("profile");
            }}
            onLocaleChange={setLocale}
            onLogout={() => void logout()}
            onManageBilling={openBillingPortal}
            onOpenBilling={() => {
              setShowBilling(true);
              setStep("payment");
            }}
            plans={plans}
            saving={saving}
            stripeConfigured={stripeConfigured}
          />
        </>
      )}
    </>
  );
}

function OnboardingShell({
  account,
  copy,
  error,
  form,
  locale,
  message,
  onBackToStudio,
  onChange,
  onLocaleChange,
  onManageBilling,
  onSaveAccount,
  onStartCheckout,
  plans,
  saving,
  selectedPlan,
  setStep,
  showBackToStudio,
  step,
  stripeConfigured,
}: {
  account: StoredAccount | null;
  copy: Messages;
  error: string;
  form: FormState;
  locale: Locale;
  message: string;
  onBackToStudio: () => void;
  onChange: (form: FormState) => void;
  onLocaleChange: (locale: Locale) => void;
  onManageBilling: () => void;
  onSaveAccount: (nextStep: "workflow" | "payment") => void;
  onStartCheckout: () => void;
  plans: ClipCraftPlan[];
  saving: boolean;
  selectedPlan: ClipCraftPlan;
  setStep: (step: "profile" | "workflow" | "payment") => void;
  showBackToStudio: boolean;
  step: "profile" | "workflow" | "payment";
  stripeConfigured: boolean;
}) {
  const steps = [
    { id: "profile", label: copy.onboarding.steps.profile, icon: UserRound },
    { id: "workflow", label: copy.onboarding.steps.workflow, icon: Palette },
    { id: "payment", label: copy.onboarding.steps.payment, icon: CreditCard },
  ] as const;

  return (
    <main className="min-h-screen bg-[#f7f7f2] text-[#15120d]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1380px] gap-5 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-6">
        <aside className="flex flex-col justify-between rounded-lg border border-black/10 bg-[#15120d] p-5 text-white shadow-xl shadow-black/10">
          <div>
            <div className="flex items-center gap-3">
              <span className="relative grid size-9 place-items-center rounded-full bg-white text-black">
                <span className="size-2.5 rounded-full bg-[#ff4d2e]" />
              </span>
              <div>
                <p className="font-serif text-2xl leading-none">ClipCraft</p>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
                  {copy.onboarding.brandMode}
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-2">
              {steps.map((item) => {
                const Icon = item.icon;
                const active = step === item.id;
                const done =
                  item.id === "profile"
                    ? step !== "profile"
                    : item.id === "workflow"
                      ? step === "payment"
                      : hasAccess(account);

                return (
                  <button
                    className={[
                      "flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left text-sm transition",
                      active
                        ? "border-white bg-white text-black"
                        : "border-white/10 text-white/65 hover:border-white/30 hover:text-white",
                    ].join(" ")}
                    key={item.id}
                    onClick={() => setStep(item.id)}
                    type="button"
                  >
                    <Icon className="size-4" />
                    <span className="font-semibold">{item.label}</span>
                    {done ? <Check className="ml-auto size-4" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 flex items-center gap-2 text-[#b7ff4a]">
              <LockKeyhole className="size-4" />
              <span className="font-mono text-xs uppercase tracking-[0.14em]">
                {copy.onboarding.secureBilling}
              </span>
            </div>
            <p className="text-sm leading-6 text-white/70">
              {stripeConfigured
                ? copy.onboarding.stripeConfigured
                : copy.onboarding.stripeLocal}
            </p>
          </div>
        </aside>

        <section className="flex min-h-[calc(100vh-32px)] flex-col rounded-lg border border-black/10 bg-white shadow-xl shadow-black/5">
          <header className="flex flex-col gap-3 border-b border-black/10 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">
                {step === "payment" ? copy.onboarding.checkout : copy.onboarding.setup}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                {step === "profile"
                  ? copy.onboarding.profileTitle
                  : step === "workflow"
                    ? copy.onboarding.workflowTitle
                    : copy.onboarding.paymentTitle}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <LanguageToggle
                copy={copy}
                locale={locale}
                onLocaleChange={onLocaleChange}
                tone="light"
              />
              {showBackToStudio ? (
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-black/10 px-3 text-sm font-semibold transition hover:border-black/30"
                  onClick={onBackToStudio}
                  type="button"
                >
                  <ArrowRight className="size-4 rotate-180" />
                  {copy.onboarding.studio}
                </button>
              ) : null}
              {hasAccess(account) ? (
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-black px-3 text-sm font-semibold text-white transition hover:bg-black/85"
                  disabled={saving}
                  onClick={onManageBilling}
                  type="button"
                >
                  <Receipt className="size-4" />
                  {copy.onboarding.billing}
                </button>
              ) : null}
            </div>
          </header>

          <div className="flex-1 p-5">
            {error ? (
              <div className="mb-4 rounded-md border border-[#ff4d2e]/35 bg-[#ff4d2e]/10 px-4 py-3 text-sm text-[#8f2211]">
                {error}
              </div>
            ) : null}
            {message ? (
              <div className="mb-4 rounded-md border border-[#1f8a5b]/25 bg-[#1f8a5b]/10 px-4 py-3 text-sm text-[#176346]">
                {message}
              </div>
            ) : null}

            {step === "profile" ? (
              <ProfileStep
                form={form}
                copy={copy}
                onChange={onChange}
                onContinue={() => onSaveAccount("workflow")}
                saving={saving}
              />
            ) : null}

            {step === "workflow" ? (
              <WorkflowStep
                form={form}
                copy={copy}
                onChange={onChange}
                onBack={() => setStep("profile")}
                onContinue={() => onSaveAccount("payment")}
                saving={saving}
              />
            ) : null}

            {step === "payment" ? (
              <PaymentStep
                account={account}
                copy={copy}
                form={form}
                locale={locale}
                onChange={onChange}
                onStartCheckout={onStartCheckout}
                plans={plans}
                saving={saving}
                selectedPlan={selectedPlan}
                stripeConfigured={stripeConfigured}
              />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function LoginShell({
  code,
  copy,
  devOtp,
  email,
  error,
  locale,
  message,
  mode,
  onChangeCode,
  onChangeEmail,
  onChangeMode,
  onChangeRegisterName,
  onChangeRegisterWorkspace,
  onLocaleChange,
  onRequestCode,
  onVerifyCode,
  otpSentTo,
  registerName,
  registerWorkspace,
  saving,
}: {
  code: string;
  copy: Messages;
  devOtp: string;
  email: string;
  error: string;
  locale: Locale;
  message: string;
  mode: AuthMode;
  onChangeCode: (value: string) => void;
  onChangeEmail: (value: string) => void;
  onChangeMode: (mode: AuthMode) => void;
  onChangeRegisterName: (value: string) => void;
  onChangeRegisterWorkspace: (value: string) => void;
  onLocaleChange: (locale: Locale) => void;
  onRequestCode: () => void;
  onVerifyCode: () => void;
  otpSentTo: string;
  registerName: string;
  registerWorkspace: string;
  saving: boolean;
}) {
  const isRegister = mode === "register";

  return (
    <main className="min-h-screen bg-[#f7f7f2] px-4 py-4 text-[#15120d]">
      <div className="mx-auto grid min-h-[calc(100vh-32px)] w-full max-w-[1180px] gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex flex-col justify-between rounded-lg border border-black/10 bg-[#15120d] p-5 text-white shadow-xl shadow-black/10">
          <div>
            <div className="flex items-center gap-3">
              <span className="relative grid size-10 place-items-center rounded-full bg-white text-black">
                <span className="size-2.5 rounded-full bg-[#ff4d2e]" />
              </span>
              <div>
                <p className="font-serif text-2xl leading-none">ClipCraft</p>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
                  {copy.login.brandMode}
                </p>
              </div>
            </div>

            <div className="mt-10 space-y-3">
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                <Mail className="mb-4 size-5 text-[#35d7ff]" />
                <h2 className="text-lg font-semibold">{copy.login.otpTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  {copy.login.otpBody}
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                <CreditCard className="mb-4 size-5 text-[#b7ff4a]" />
                <h2 className="text-lg font-semibold">{copy.login.checkoutTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  {copy.login.checkoutBody}
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm leading-6 text-white/45">
            {copy.login.resendHint}
          </p>
        </aside>

        <section className="rounded-lg border border-black/10 bg-white shadow-xl shadow-black/5">
          <header className="flex flex-col gap-3 border-b border-black/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">
                {isRegister ? copy.login.registerEyebrow : copy.login.eyebrow}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                {isRegister ? copy.login.registerTitle : copy.login.title}
              </h1>
            </div>
            <LanguageToggle
              copy={copy}
              locale={locale}
              onLocaleChange={onLocaleChange}
              tone="light"
            />
          </header>

          <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid content-start gap-4">
              <div
                aria-label={copy.login.authMode}
                className="grid grid-cols-2 rounded-md border border-black/10 bg-[#f7f7f2] p-1"
                role="group"
              >
                {(["login", "register"] as const).map((item) => (
                  <button
                    className={[
                      "h-10 rounded text-sm font-bold transition",
                      mode === item
                        ? "bg-black text-white"
                        : "text-black/55 hover:text-black",
                    ].join(" ")}
                    key={item}
                    onClick={() => onChangeMode(item)}
                    type="button"
                  >
                    {item === "login"
                      ? copy.login.signInTab
                      : copy.login.registerTab}
                  </button>
                ))}
              </div>

              {error ? (
                <div className="rounded-md border border-[#ff4d2e]/35 bg-[#ff4d2e]/10 px-4 py-3 text-sm text-[#8f2211]">
                  {error}
                </div>
              ) : null}
              {message ? (
                <div className="rounded-md border border-[#1f8a5b]/25 bg-[#1f8a5b]/10 px-4 py-3 text-sm text-[#176346]">
                  {message}
                </div>
              ) : null}

              {isRegister ? (
                <>
                  <Field
                    icon={<UserRound className="size-4" />}
                    label={copy.login.name}
                    onChange={onChangeRegisterName}
                    placeholder="Mira Schaefer"
                    value={registerName}
                  />
                  <Field
                    icon={<Building2 className="size-4" />}
                    label={copy.login.workspace}
                    onChange={onChangeRegisterWorkspace}
                    placeholder="Mira Studio"
                    value={registerWorkspace}
                  />
                </>
              ) : null}

              <Field
                icon={<Mail className="size-4" />}
                label={copy.login.email}
                onChange={onChangeEmail}
                placeholder={copy.login.emailPlaceholder}
                type="email"
                value={email}
              />

              <button
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white transition hover:bg-black/85 disabled:opacity-50"
                disabled={saving}
                onClick={onRequestCode}
                type="button"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {isRegister ? copy.login.sendRegistrationCode : copy.login.sendCode}
              </button>

              {otpSentTo ? (
                <>
                  <Field
                    icon={<KeyRound className="size-4" />}
                    label={copy.login.code}
                    onChange={(value) =>
                      onChangeCode(value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="123456"
                    inputMode="numeric"
                    value={code}
                  />
                  {devOtp ? (
                    <div className="rounded-md border border-[#35d7ff]/25 bg-[#35d7ff]/10 px-4 py-3">
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#0c6d83]">
                        {copy.login.devCode}
                      </p>
                      <p
                        className="mt-1 font-mono text-2xl font-semibold tracking-[0.2em] text-black"
                        data-testid="dev-otp-code"
                      >
                        {devOtp}
                      </p>
                    </div>
                  ) : null}
                  <button
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#b7ff4a] px-4 text-sm font-bold text-black transition hover:bg-[#d4ff8a] disabled:opacity-50"
                    disabled={saving || code.length !== 6}
                    onClick={onVerifyCode}
                    type="button"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {isRegister ? copy.login.registerSubmit : copy.login.submit}
                  </button>
                </>
              ) : null}
            </div>

            <div className="rounded-lg border border-black/10 bg-[#f7f7f2] p-5">
              <LockKeyhole className="mb-4 size-6 text-[#ff4d2e]" />
              <h2 className="text-xl font-semibold">
                {isRegister
                  ? copy.login.registerFlowTitle
                  : copy.login.cleanFlowTitle}
              </h2>
              <p className="mt-3 text-sm leading-6 text-black/60">
                {isRegister
                  ? copy.login.registerFlowBody
                  : copy.login.cleanFlowBody}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ProfileStep({
  copy,
  form,
  onChange,
  onContinue,
  saving,
}: {
  copy: Messages;
  form: FormState;
  onChange: (form: FormState) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid content-start gap-4">
        <Field
          icon={<UserRound className="size-4" />}
          label={copy.onboarding.name}
          onChange={(value) => onChange({ ...form, name: value })}
          placeholder="Mira Schaefer"
          value={form.name}
        />
        <Field
          icon={<Receipt className="size-4" />}
          label={copy.onboarding.verifiedEmail}
          onChange={(value) => onChange({ ...form, email: value })}
          placeholder="mira@studio.com"
          type="email"
          value={form.email}
          disabled
        />
        <Field
          icon={<Building2 className="size-4" />}
          label={copy.onboarding.workspace}
          onChange={(value) => onChange({ ...form, workspaceName: value })}
          placeholder="Mira Studio"
          value={form.workspaceName}
        />

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-black/45">
            {copy.onboarding.role}
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {roleOptions.map((role) => (
              <button
                className={[
                  "h-11 rounded-md border px-3 text-left text-sm font-semibold transition",
                  form.role === role
                    ? "border-black bg-black text-white"
                    : "border-black/10 bg-[#f7f7f2] hover:border-black/30",
                ].join(" ")}
                key={role}
                onClick={() => onChange({ ...form, role })}
                type="button"
              >
                {copy.onboarding.roles[role]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-black/10 bg-[#f7f7f2] p-5">
        <Sparkles className="mb-4 size-6 text-[#ff4d2e]" />
        <h2 className="text-xl font-semibold">{copy.onboarding.quickStart}</h2>
        <p className="mt-3 text-sm leading-6 text-black/60">
          {copy.onboarding.quickStartBody}
        </p>
        <button
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white transition hover:bg-black/85 disabled:opacity-50"
          disabled={saving}
          onClick={onContinue}
          type="button"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {copy.onboarding.next}
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function WorkflowStep({
  copy,
  form,
  onBack,
  onChange,
  onContinue,
  saving,
}: {
  copy: Messages;
  form: FormState;
  onBack: () => void;
  onChange: (form: FormState) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid content-start gap-5">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-black/45">
            {copy.onboarding.mainWorkflow}
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            {goalOptions.map((goal) => (
              <button
                className={[
                  "rounded-lg border p-4 text-left transition",
                  form.primaryGoal === goal
                    ? "border-black bg-black text-white"
                    : "border-black/10 bg-[#f7f7f2] hover:border-black/30",
                ].join(" ")}
                key={goal}
                onClick={() => onChange({ ...form, primaryGoal: goal })}
                type="button"
              >
                <BadgeCheck className="mb-4 size-5" />
                <span className="block text-base font-semibold">
                  {copy.onboarding.goals[goal]}
                </span>
                <span className="mt-2 block text-sm opacity-65">
                  {goal === "Batch Export"
                    ? copy.onboarding.batchExportBody
                    : goal === "Auto-cut"
                      ? copy.onboarding.autoCutBody
                      : copy.onboarding.defaultGoalBody}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-black/45">
            {copy.onboarding.brandAccent}
          </label>
          <div className="flex flex-wrap gap-2">
            {accentOptions.map((accent) => (
              <button
                aria-label={`Accent ${accent}`}
                className={[
                  "grid size-11 place-items-center rounded-md border transition",
                  form.brandAccent === accent
                    ? "border-black"
                    : "border-black/10 hover:border-black/30",
                ].join(" ")}
                key={accent}
                onClick={() => onChange({ ...form, brandAccent: accent })}
                type="button"
              >
                <span
                  className="size-7 rounded-sm"
                  style={{ backgroundColor: accent }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-black/10 bg-[#15120d] p-5 text-white">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-white/45">
          {copy.onboarding.workspacePreview}
        </p>
        <h2 className="mt-4 text-2xl font-semibold">
          {form.workspaceName || "ClipCraft Studio"}
        </h2>
        <p className="mt-2 text-sm text-white/55">{form.primaryGoal}</p>
        <div className="mt-8 h-32 rounded-md border border-white/10 bg-white/[0.04] p-4">
          <div
            className="h-full rounded"
            style={{
              background: `linear-gradient(135deg, ${form.brandAccent}, #10110f)`,
            }}
          />
        </div>
        <div className="mt-6 flex gap-2">
          <button
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-white/10 px-4 text-sm font-semibold text-white/75 transition hover:border-white/30 hover:text-white"
            onClick={onBack}
            type="button"
          >
          {copy.onboarding.back}
          </button>
          <button
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
            disabled={saving}
            onClick={onContinue}
            type="button"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {copy.onboarding.plan}
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentStep({
  account,
  copy,
  form,
  locale,
  onChange,
  onStartCheckout,
  plans,
  saving,
  selectedPlan,
  stripeConfigured,
}: {
  account: StoredAccount | null;
  copy: Messages;
  form: FormState;
  locale: Locale;
  onChange: (form: FormState) => void;
  onStartCheckout: () => void;
  plans: ClipCraftPlan[];
  saving: boolean;
  selectedPlan: ClipCraftPlan;
  stripeConfigured: boolean;
}) {
  const active = hasAccess(account);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid content-start gap-3 md:grid-cols-2">
        {plans.map((plan) => {
          const selected = form.planId === plan.id;
          return (
            <button
              className={[
                "rounded-lg border p-5 text-left transition",
                selected
                  ? "border-black bg-black text-white"
                  : "border-black/10 bg-[#f7f7f2] hover:border-black/30",
              ].join(" ")}
              key={plan.id}
              onClick={() => onChange({ ...form, planId: plan.id })}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xl font-semibold">{plan.name}</p>
                  <p className="mt-1 text-sm opacity-60">
                    {planPriceLabel(plan.priceLabel, locale)}
                  </p>
                </div>
                {selected ? <Check className="size-5" /> : null}
              </div>
              <div className="mt-8 grid grid-cols-2 gap-2 text-sm">
                <span className="rounded-md bg-white/10 px-3 py-2">
                  {plan.minutes} min
                </span>
                <span className="rounded-md bg-white/10 px-3 py-2">
                  {plan.exports} PNGs
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <aside className="rounded-lg border border-black/10 bg-[#f7f7f2] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-black/45">
              {copy.onboarding.checkoutBox}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{selectedPlan.name}</h2>
            <p className="mt-1 text-sm text-black/55">
              {planPriceLabel(selectedPlan.priceLabel, locale)}
            </p>
          </div>
          <span className="rounded-md border border-black/10 bg-white px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-black/50">
            {stripeConfigured
              ? copy.onboarding.stripeBadge
              : copy.onboarding.testBadge}
          </span>
        </div>

        <div className="mt-6 space-y-3 text-sm text-black/70">
          <p className="flex items-center gap-2">
            <Check className="size-4 text-[#1f8a5b]" />
            {copy.onboarding.aiTranscript}
          </p>
          <p className="flex items-center gap-2">
            <Check className="size-4 text-[#1f8a5b]" />
            {copy.onboarding.pngExport}
          </p>
          <p className="flex items-center gap-2">
            <Check className="size-4 text-[#1f8a5b]" />
            {copy.onboarding.projectArchive}
          </p>
        </div>

        <button
          className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white transition hover:bg-black/85 disabled:opacity-50"
          disabled={saving}
          onClick={onStartCheckout}
          type="button"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
          {active
            ? copy.onboarding.updatePlan
            : stripeConfigured
              ? copy.onboarding.stripeCheckout
              : copy.onboarding.activateTestPayment}
        </button>

        {active ? (
          <div className="mt-4 rounded-md border border-[#1f8a5b]/20 bg-[#1f8a5b]/10 px-3 py-2 text-sm text-[#176346]">
            {copy.onboarding.activeSubscription}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Field({
  icon,
  disabled = false,
  inputMode,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  icon: ReactNode;
  disabled?: boolean;
  inputMode?: "text" | "numeric" | "email";
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  value: string;
}) {
  return (
    <label>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-black/45">
        {label}
      </span>
      <span className="flex h-12 items-center gap-3 rounded-md border border-black/10 bg-[#f7f7f2] px-3 transition focus-within:border-black/35">
        <span className="text-black/40">{icon}</span>
        <input
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-black/30 disabled:cursor-not-allowed disabled:text-black/45"
          disabled={disabled}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
      </span>
    </label>
  );
}

function LanguageToggle({
  copy,
  locale,
  onLocaleChange,
  tone,
}: {
  copy: Messages;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  tone: "dark" | "light";
}) {
  const dark = tone === "dark";

  return (
    <div
      aria-label={copy.locale.label}
      className={[
        "inline-flex h-10 items-center gap-1 rounded-md border p-1",
        dark ? "border-white/10 bg-white/[0.04]" : "border-black/10 bg-white",
      ].join(" ")}
      role="group"
    >
      <Languages
        className={["mx-1 size-4", dark ? "text-white/50" : "text-black/45"].join(
          " ",
        )}
      />
      {(["de", "en"] as const).map((item) => (
        <button
          className={[
            "h-8 rounded px-2 text-xs font-bold transition",
            locale === item
              ? dark
                ? "bg-white text-black"
                : "bg-black text-white"
              : dark
                ? "text-white/55 hover:text-white"
                : "text-black/50 hover:text-black",
          ].join(" ")}
          key={item}
          onClick={() => onLocaleChange(item)}
          type="button"
        >
          {copy.locale[item]}
        </button>
      ))}
    </div>
  );
}

function hasAccess(account: StoredAccount | null) {
  return Boolean(
    account?.onboardingCompletedAt &&
      (account.billing.status === "active" ||
        account.billing.status === "trialing"),
  );
}
