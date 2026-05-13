import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_LOCALE, getMessages, type Locale } from "@/lib/i18n";

export const SESSION_COOKIE_NAME = "clipcraft_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

type OtpRecord = {
  id: string;
  email: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  consumedAt: string | null;
};

type SessionRecord = {
  id: string;
  accountId: string;
  email: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

type AuthState = {
  otps: OtpRecord[];
  sessions: SessionRecord[];
};

export type OtpRequestResult = {
  email: string;
  expiresAt: string;
  delivery: "email" | "dev";
  devOtp?: string;
};

export type SessionResult = {
  token: string;
  session: SessionRecord;
};

function getDataDir() {
  return process.env.CLIPCRAFT_DATA_DIR ?? join(process.cwd(), ".clipcraft-data");
}

function getAuthPath() {
  return join(getDataDir(), "auth.json");
}

export async function requestOtp(
  emailInput: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<OtpRequestResult> {
  const copy = getMessages(locale).api;
  const email = normalizeEmail(emailInput);
  if (!email) {
    throw new Error(copy.otpInvalidEmail);
  }

  const code = String(randomInt(100000, 1000000));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);
  const state = await readAuthState();

  state.otps = pruneExpiredOtps(state.otps);
  state.otps.push({
    id: randomUUID(),
    email,
    codeHash: hashSecret(code),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    attempts: 0,
    consumedAt: null,
  });

  await writeAuthState(state);

  if (process.env.RESEND_API_KEY) {
    await sendOtpEmail(email, code, locale);
    return {
      email,
      expiresAt: expiresAt.toISOString(),
      delivery: "email",
    };
  }

  return {
    email,
    expiresAt: expiresAt.toISOString(),
    delivery: "dev",
    devOtp: code,
  };
}

export async function verifyOtp(emailInput: string, codeInput: string) {
  const email = normalizeEmail(emailInput);
  const code = String(codeInput || "").replace(/\D/g, "");
  if (!email || code.length !== 6) {
    return { ok: false as const, reason: "invalid" as const };
  }

  const state = await readAuthState();
  const now = new Date();
  const otp = state.otps
    .filter((record) => record.email === email && !record.consumedAt)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

  if (!otp) return { ok: false as const, reason: "not_found" as const };
  if (new Date(otp.expiresAt).getTime() <= now.getTime()) {
    return { ok: false as const, reason: "expired" as const };
  }
  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false as const, reason: "locked" as const };
  }

  if (otp.codeHash !== hashSecret(code)) {
    otp.attempts += 1;
    await writeAuthState(state);
    return { ok: false as const, reason: "mismatch" as const };
  }

  otp.consumedAt = now.toISOString();
  await writeAuthState(state);
  return { ok: true as const, email };
}

export async function createSession(input: {
  accountId: string;
  email: string;
}): Promise<SessionResult> {
  const state = await readAuthState();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const token = randomUUID() + "." + randomUUID();
  const session: SessionRecord = {
    id: randomUUID(),
    accountId: input.accountId,
    email: normalizeEmail(input.email),
    tokenHash: hashSecret(token),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  state.sessions = pruneExpiredSessions(state.sessions);
  state.sessions.push(session);
  await writeAuthState(state);

  return { token, session };
}

export async function readSession(token: string | undefined | null) {
  if (!token) return null;

  const state = await readAuthState();
  const tokenHash = hashSecret(token);
  const session = state.sessions.find((item) => item.tokenHash === tokenHash);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteSession(token);
    return null;
  }
  return session;
}

export async function deleteSession(token: string | undefined | null) {
  if (!token) return;

  const state = await readAuthState();
  const tokenHash = hashSecret(token);
  state.sessions = state.sessions.filter(
    (session) => session.tokenHash !== tokenHash,
  );
  await writeAuthState(state);
}

export async function clearAuthStateForTests() {
  await writeAuthState({ otps: [], sessions: [] });
}

async function readAuthState(): Promise<AuthState> {
  await ensureStore();

  try {
    const content = await readFile(getAuthPath(), "utf8");
    const parsed = JSON.parse(content) as AuthState;
    return {
      otps: Array.isArray(parsed.otps) ? parsed.otps : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { otps: [], sessions: [] };
  }
}

async function writeAuthState(state: AuthState) {
  await ensureStore();
  const authPath = getAuthPath();
  const tempPath = `${authPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
  await rename(tempPath, authPath);
}

async function ensureStore() {
  await mkdir(getDataDir(), { recursive: true });
}

function pruneExpiredOtps(records: OtpRecord[]) {
  const now = Date.now();
  return records.filter(
    (record) =>
      !record.consumedAt && new Date(record.expiresAt).getTime() > now,
  );
}

function pruneExpiredSessions(records: SessionRecord[]) {
  const now = Date.now();
  return records.filter((record) => new Date(record.expiresAt).getTime() > now);
}

async function sendOtpEmail(email: string, code: string, locale: Locale) {
  const from =
    process.env.OTP_EMAIL_FROM ?? "ClipCraft <onboarding@resend.dev>";
  const subject =
    locale === "en" ? "Your ClipCraft login code" : "Dein ClipCraft Login-Code";
  const html =
    locale === "en"
      ? `<p>Your login code is <strong>${code}</strong>. It is valid for ${OTP_TTL_MINUTES} minutes.</p>`
      : `<p>Dein Login-Code lautet <strong>${code}</strong>. Er ist ${OTP_TTL_MINUTES} Minuten gueltig.</p>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      payload?.message ?? getMessages(locale).api.otpSend,
    );
  }
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase().slice(0, 180);
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
