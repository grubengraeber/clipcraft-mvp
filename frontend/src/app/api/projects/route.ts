import { NextResponse } from "next/server";

import {
  createProject,
  listProjects,
} from "@/lib/project-store";
import type { StoredProjectPayload } from "@/lib/clipcraft";
import { accountHasAccess, recordUsage } from "@/lib/account-store";
import { apiErrorResponse } from "@/lib/api-responses";
import { requireSessionAccount } from "@/lib/auth-session";
import { getMessages, getRequestLocale, type Locale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    await requireSessionAccount();
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    return apiErrorResponse(error, copy.projectsLoad, 500, locale);
  }
}

export async function POST(request: Request) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  try {
    const { account } = await requireSessionAccount();
    if (!accountHasAccess(account)) {
      return NextResponse.json(
        {
          error: copy.projectPaywallSave,
        },
        { status: 402 },
      );
    }

    const formData = await request.formData();
    const video = formData.get("video");
    const thumbnail = formData.get("thumbnail");
    const payload = parsePayload(formData.get("payload"), locale);

    if (!(video instanceof File)) {
      return NextResponse.json(
        { error: copy.projectNeedsVideo },
        { status: 400 },
      );
    }

    const project = await createProject({
      video,
      thumbnail: thumbnail instanceof File ? thumbnail : null,
      payload,
    });

    await recordUsage(0, thumbnail instanceof File ? 1 : 0);

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, copy.projectSave, 500, locale);
  }
}

function parsePayload(
  value: FormDataEntryValue | null,
  locale: Locale,
): StoredProjectPayload {
  if (typeof value !== "string") {
    throw new Error(getMessages(locale).api.projectMetadataMissing);
  }

  return JSON.parse(value) as StoredProjectPayload;
}
