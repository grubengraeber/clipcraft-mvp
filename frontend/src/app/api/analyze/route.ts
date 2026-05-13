import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  accountHasAccess,
  getPlan,
  recordUsage,
} from "@/lib/account-store";
import { apiErrorResponse } from "@/lib/api-responses";
import { requireSessionAccount } from "@/lib/auth-session";
import { creativeBriefSchema, type AnalyzeResponse } from "@/lib/clipcraft";
import { getMessages, getRequestLocale, type Locale } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
const MAX_FRAME_COUNT = 8;
const MAX_FRAME_DATA_URL_LENGTH = 850_000;
const TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-5";

const submittedFrameSchema = z.object({
  time: z.number().min(0).max(61),
  score: z.number().min(0).max(100),
  dataUrl: z
    .string()
    .startsWith("data:image/")
    .max(MAX_FRAME_DATA_URL_LENGTH),
  metrics: z.object({
    brightness: z.number(),
    contrast: z.number(),
    sharpness: z.number(),
    saturation: z.number(),
  }),
});

type SubmittedFrame = z.infer<typeof submittedFrameSchema>;
type ApiMessages = ReturnType<typeof getMessages>["api"];

let openaiClient: OpenAI | null = null;

function getOpenAIClient(copy: ApiMessages) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(copy.openaiMissing);
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openaiClient;
}

export async function POST(request: Request) {
  const locale = getRequestLocale(request);
  const copy = getMessages(locale).api;
  const tempPaths: string[] = [];

  try {
    const { account } = await requireSessionAccount();
    if (!accountHasAccess(account)) {
      return NextResponse.json(
        {
          error: copy.analyzePaywall,
        },
        { status: 402 },
      );
    }

    const plan = getPlan(account.billing.planId);
    if (account.usage.monthlyMinutesUsed >= plan.minutes) {
      return NextResponse.json(
        {
          error: copy.analyzeLimit,
        },
        { status: 402 },
      );
    }

    const formData = await request.formData();
    const upload = formData.get("video");
    const frames = parseSubmittedFrames(formData.get("frames"));
    const durationSeconds = parseDurationSeconds(formData.get("durationSeconds"));

    if (!(upload instanceof File)) {
      return NextResponse.json(
        { error: copy.analyzeUpload },
        { status: 400 },
      );
    }

    if (!upload.type.startsWith("video/") && !upload.type.startsWith("audio/")) {
      return NextResponse.json(
        { error: copy.analyzeFileType },
        { status: 400 },
      );
    }

    if (upload.size > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        {
          error: copy.analyzeFileSize,
        },
        { status: 413 },
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      const payload = buildLocalFallbackResponse({
        upload,
        frames,
        locale,
        copy,
      });
      await recordUsage(Math.max(1 / 60, durationSeconds / 60));
      return NextResponse.json(payload);
    }

    const client = getOpenAIClient(copy);
    const workDir = join(tmpdir(), "clipcraft");
    await mkdir(workDir, { recursive: true });

    const id = randomUUID();
    const sourceExt = getSafeExtension(upload.name, upload.type);
    const sourcePath = join(workDir, `${id}${sourceExt}`);
    const audioPath = join(workDir, `${id}.mp3`);
    tempPaths.push(sourcePath, audioPath);

    const sourceBuffer = Buffer.from(await upload.arrayBuffer());
    await writeFile(sourcePath, sourceBuffer);

    await extractAudio(sourcePath, audioPath, copy);

    const audioBuffer = await readFile(audioPath);
    const audioFile = await toFile(audioBuffer, `${id}.mp3`, {
      type: "audio/mpeg",
    });

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: TRANSCRIPTION_MODEL,
      response_format: "json",
      temperature: 0,
    });

    const transcript = transcription.text.trim();
    if (!transcript) {
      return NextResponse.json(
        {
          error:
            copy.noTranscript,
        },
        { status: 422 },
      );
    }

    const creative = await client.responses.parse({
      model: TEXT_MODEL,
      input: [
        {
          role: "system",
          content:
            locale === "en"
              ? "You are an English-speaking creative director for social video and a thumbnail editor with excellent visual judgment. Pick the best supplied frame because it is clear, sharp, emotional and instantly understandable. Write a short catchline that fits the visible scene and the transcript. No false clickbait, no emoji, no generic phrases. Headline max 7 words."
              : "Du bist ein deutschsprachiger Creative Director fuer Social Video und ein Thumbnail-Editor mit sehr gutem visuellem Urteilsvermoegen. Waehle den besten Frame aus den gelieferten Kandidaten, weil er klar, scharf, emotional und sofort verstaendlich ist. Schreibe eine kurze Catchline, die zur visuellen Szene und zum Transkript passt. Keine Clickbait-Luegen, keine Emojis, keine generischen Phrasen. Headline maximal 7 Woerter.",
        },
        {
          role: "user",
          content: buildVisionPrompt({
            fileName: upload.name || "video",
            transcript,
            frames,
            locale,
          }),
        },
      ],
      text: {
        format: zodTextFormat(creativeBriefSchema, "clipcraft_creative_brief"),
      },
    });

    if (!creative.output_parsed) {
      return NextResponse.json(
        { error: copy.structuredAnalysis },
        { status: 502 },
      );
    }

    const payload: AnalyzeResponse = {
      transcript,
      creative: creative.output_parsed,
      meta: {
        sourceName: upload.name || "video",
        sourceBytes: upload.size,
        extractedAudioBytes: audioBuffer.byteLength,
        analyzedFrames: frames.length,
        transcriptionModel: TRANSCRIPTION_MODEL,
        textModel: TEXT_MODEL,
      },
    };

    await recordUsage(Math.max(1 / 60, durationSeconds / 60));

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return apiErrorResponse(error, copy.authRequired, 500, locale);
    }
    const apiError = normalizeApiError(error, locale);
    return NextResponse.json(
      { error: apiError.message },
      { status: apiError.status },
    );
  } finally {
    await Promise.allSettled(tempPaths.map((path) => unlink(path)));
  }
}

function parseDurationSeconds(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 60) : 0;
}

function buildLocalFallbackResponse({
  upload,
  frames,
  locale,
  copy,
}: {
  upload: File;
  frames: SubmittedFrame[];
  locale: Locale;
  copy: ApiMessages;
}): AnalyzeResponse {
  const bestFrame = frames[0];
  const baseTitle =
    upload.name
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .slice(0, 42) || "Neuer Clip";
  const headline = makeHeadline(baseTitle);
  const keywords = [
    "video",
    "thumbnail",
    "hook",
    "social",
    "clip",
    "export",
  ];

  return {
    transcript: copy.localTranscript,
    creative: {
      language: locale,
      summary: copy.localSummary(baseTitle),
      primaryTopic: baseTitle,
      audience: copy.localAudience,
      keywords,
      headline,
      subtitle: copy.localSubtitle,
      hook: headline,
      mood: "premium",
      titleAlternatives: [
        headline,
        copy.titleMoment(baseTitle),
        copy.titleBestFrame,
        copy.titleFastCover,
      ],
      platformCopy: {
        youtube: headline,
        instagram: copy.instagramReady(headline),
        tiktok: headline,
      },
      selectedFrame: {
        candidateTime: bestFrame?.time ?? 0,
        visibleMoment: bestFrame
          ? copy.frameAt(bestFrame.time.toFixed(2))
          : copy.firstFrame,
        rationale: copy.localRationale,
        recommendedCrop: "center",
        visualScore: Math.round(bestFrame?.score ?? 70),
      },
      visualDirection: {
        focalPoint: copy.focalPoint,
        frameHints: [
          copy.hintShortHeadline,
          copy.hintContrast,
          copy.hintExport,
        ],
        colorMood: copy.colorMood,
        composition: copy.composition,
        overlayStyle: "bold",
        accentColor: "signal",
      },
    },
    meta: {
      sourceName: upload.name || "video",
      sourceBytes: upload.size,
      extractedAudioBytes: 0,
      analyzedFrames: frames.length,
      transcriptionModel: "local-fallback",
      textModel: "local-fallback",
    },
  };
}

function makeHeadline(value: string) {
  const words = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
  return words ? words.toUpperCase() : "CLIPCRAFT";
}

function normalizeApiError(error: unknown, locale: Locale) {
  const copy = getMessages(locale).api;
  const maybeError = error as {
    status?: number;
    code?: string;
    message?: string;
  };
  const status = maybeError.status ?? 500;
  const rawMessage =
    error instanceof Error
      ? error.message
      : maybeError.message ?? copy.analyzeUnexpected;
  const lowerMessage = rawMessage.toLowerCase();

  if (
    status === 429 ||
    maybeError.code === "insufficient_quota" ||
    lowerMessage.includes("quota")
  ) {
    return {
      status: 429,
      message: copy.quota,
    };
  }

  if (status === 401) {
    return {
      status: 401,
      message: copy.openaiKey,
    };
  }

  return {
    status,
    message: rawMessage,
  };
}

function parseSubmittedFrames(value: FormDataEntryValue | null): SubmittedFrame[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  const frames = z.array(submittedFrameSchema).max(MAX_FRAME_COUNT).parse(parsed);

  return frames.slice(0, MAX_FRAME_COUNT);
}

function buildVisionPrompt({
  fileName,
  transcript,
  frames,
  locale,
}: {
  fileName: string;
  transcript: string;
  frames: SubmittedFrame[];
  locale: Locale;
}) {
  const frameIndex = frames
    .map(
      (frame, index) =>
        `Frame ${index + 1}: time=${frame.time.toFixed(2)}s, heuristicScore=${frame.score.toFixed(1)}, sharpness=${frame.metrics.sharpness.toFixed(1)}, contrast=${frame.metrics.contrast.toFixed(1)}, brightness=${frame.metrics.brightness.toFixed(1)}, saturation=${frame.metrics.saturation.toFixed(2)}`,
    )
    .join("\n");

  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "low" | "auto" }
  > = [
    {
      type: "input_text",
      text:
        locale === "en"
          ? [
              "Analyze this video for a social-media thumbnail.",
              "Use both transcript AND visible frames. The headline must work as a thumbnail: short, concrete, strong, readable.",
              "Set selectedFrame.candidateTime exactly to one of the supplied frame timestamps.",
              "Prioritize: clear person/object, visible action, emotion, sharpness, little visual clutter, enough room for text.",
              "If a heuristically good frame is boring, pick the more meaningful frame.",
              "",
              `File name: ${fileName}`,
              "",
              "Frame candidates:",
              frameIndex ||
                "No frames supplied. Decide from the transcript only.",
              "",
              "Transcript:",
              transcript,
            ].join("\n")
          : [
              "Analysiere dieses Video fuer ein Social-Media-Thumbnail.",
              "Nutze Transkript UND sichtbare Frames. Die Headline muss wie ein Thumbnail funktionieren: kurz, konkret, stark, lesbar.",
              "Waehle selectedFrame.candidateTime exakt aus einem der angegebenen Frame-Zeitpunkte.",
              "Priorisiere: klare Hauptperson/Objekt, erkennbare Handlung, Emotion, Schaerfe, wenig visueller Muell, genug Platz fuer Text.",
              "Wenn ein heuristisch guter Frame inhaltlich langweilig ist, waehle den inhaltlich besseren Frame.",
              "",
              `Dateiname: ${fileName}`,
              "",
              "Frame-Kandidaten:",
              frameIndex ||
                "Keine Frames geliefert. Entscheide nur aus dem Transkript.",
              "",
              "Transkript:",
              transcript,
            ].join("\n"),
    },
  ];

  frames.forEach((frame, index) => {
    content.push({
      type: "input_text",
      text:
        locale === "en"
          ? `Frame ${index + 1} at ${frame.time.toFixed(2)} seconds.`
          : `Frame ${index + 1} bei ${frame.time.toFixed(2)} Sekunden.`,
    });
    content.push({
      type: "input_image",
      image_url: frame.dataUrl,
      detail: "low",
    });
  });

  return content;
}

function extractAudio(sourcePath: string, audioPath: string, copy: ApiMessages) {
  const ffmpegPath = process.env.FFMPEG_PATH ?? ffmpegInstaller.path;

  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-t",
      "60",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "48k",
      audioPath,
    ]);

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            copy.ffmpeg,
        ),
      );
    });
  });
}

function getSafeExtension(fileName: string, mimeType: string) {
  const extension = extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(extension)) {
    return extension;
  }

  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("quicktime")) return ".mov";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType.includes("mpeg")) return ".mpeg";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("wav")) return ".wav";

  return ".mp4";
}
