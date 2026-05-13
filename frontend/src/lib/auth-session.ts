import { cookies } from "next/headers";

import { readAccount } from "@/lib/account-store";
import { readSession, SESSION_COOKIE_NAME } from "@/lib/auth-store";

export async function getSessionContext() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = await readSession(token);
  const account = session ? await readAccount() : null;

  if (!session || !account || session.accountId !== account.id) {
    return {
      token,
      session: null,
      account: null,
    };
  }

  return {
    token,
    session,
    account,
  };
}

export async function requireSessionAccount() {
  const context = await getSessionContext();
  if (!context.account) {
    throw new Error("AUTH_REQUIRED");
  }
  return context;
}

export function isAuthRequiredError(error: unknown) {
  return error instanceof Error && error.message === "AUTH_REQUIRED";
}
