import { NextResponse } from "next/server";

import type { StoredProjectPayload } from "@/lib/clipcraft";
import { accountHasAccess, recordUsage } from "@/lib/account-store";
import { apiErrorResponse } from "@/lib/api-responses";
import { requireSessionAccount } from "@/lib/auth-session";
import { getMessages, getRequestLocale, type Locale } from "@/lib/i18n";
import {
  deleteProject,
  getProject,
  updateProject,
} from "@/lib/project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    await requireSessionAccount();
    const { id } = await context.params;
    const project = await getProject(id);

    if (!project) {
      return NextResponse.json(
        { error: copy.projectNotFound },
        { status: 404 },
      );
    }

    return NextResponse.json({ project });
  } catch (error) {
    return apiErrorResponse(error, copy.projectLoad, 500, locale);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    const { account } = await requireSessionAccount();
    if (!accountHasAccess(account)) {
      return NextResponse.json(
        {
          error: copy.projectPaywallUpdate,
        },
        { status: 402 },
      );
    }

    const { id } = await context.params;
    const formData = await request.formData();
    const video = formData.get("video");
    const thumbnail = formData.get("thumbnail");
    const payload = parsePayload(formData.get("payload"), locale);

    const project = await updateProject(id, {
      video: video instanceof File ? video : null,
      thumbnail: thumbnail instanceof File ? thumbnail : null,
      payload,
    });

    if (!project) {
      return NextResponse.json(
        { error: copy.projectNotFound },
        { status: 404 },
      );
    }

    await recordUsage(0, thumbnail instanceof File ? 1 : 0);

    return NextResponse.json({ project });
  } catch (error) {
    return apiErrorResponse(error, copy.projectUpdate, 500, locale);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    const { account } = await requireSessionAccount();
    if (!accountHasAccess(account)) {
      return NextResponse.json(
        {
          error: copy.projectPaywallDelete,
        },
        { status: 402 },
      );
    }

    const { id } = await context.params;
    const deleted = await deleteProject(id);

    if (!deleted) {
      return NextResponse.json(
        { error: copy.projectNotFound },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, copy.projectDelete, 500, locale);
  }
}

function parsePayload(
  value: FormDataEntryValue | null,
  locale: Locale,
): Partial<StoredProjectPayload> {
  if (typeof value !== "string") {
    throw new Error(getMessages(locale).api.projectMetadataMissing);
  }

  return JSON.parse(value) as Partial<StoredProjectPayload>;
}
