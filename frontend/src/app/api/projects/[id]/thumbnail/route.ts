import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api-responses";
import { requireSessionAccount } from "@/lib/auth-session";
import { getMessages, getRequestLocale } from "@/lib/i18n";
import { getProjectMedia } from "@/lib/project-store";

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
    const media = await getProjectMedia(id, "thumbnail");

    if (!media) {
      return NextResponse.json(
        { error: copy.thumbnailNotFound },
        { status: 404 },
      );
    }

    return new Response(media.buffer, {
      headers: {
        "Cache-Control": "private, max-age=60",
        "Content-Length": String(media.size),
        "Content-Type": media.mimeType,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, copy.thumbnailLoad, 500, locale);
  }
}
