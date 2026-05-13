import { z } from "zod";

export const creativeBriefSchema = z.object({
  language: z.string(),
  summary: z.string(),
  primaryTopic: z.string(),
  audience: z.string(),
  keywords: z.array(z.string()).min(5).max(12),
  headline: z.string(),
  subtitle: z.string(),
  hook: z.string(),
  mood: z.enum(["energetic", "premium", "educational", "dramatic", "playful"]),
  titleAlternatives: z.array(z.string()).min(4).max(6),
  platformCopy: z.object({
    youtube: z.string(),
    instagram: z.string(),
    tiktok: z.string(),
  }),
  selectedFrame: z.object({
    candidateTime: z.number(),
    visibleMoment: z.string(),
    rationale: z.string(),
    recommendedCrop: z.enum(["center", "left", "right", "top", "bottom"]),
    visualScore: z.number().min(0).max(100),
  }),
  visualDirection: z.object({
    focalPoint: z.string(),
    frameHints: z.array(z.string()).min(3).max(6),
    colorMood: z.string(),
    composition: z.string(),
    overlayStyle: z.enum(["bold", "clean", "editorial"]),
    accentColor: z.enum(["signal", "lime", "cyan", "gold", "rose"]),
  }),
});

export type CreativeBrief = z.infer<typeof creativeBriefSchema>;

export type AnalyzeResponse = {
  transcript: string;
  creative: CreativeBrief;
  meta: {
    sourceName: string;
    sourceBytes: number;
    extractedAudioBytes: number;
    analyzedFrames: number;
    transcriptionModel: string;
    textModel: string;
  };
};

export type StoredProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceName: string;
  videoMimeType: string;
  videoBytes: number;
  thumbnailMimeType: string | null;
  headline: string;
  subtitle: string;
  presetId: string;
  accent: string;
  visualStyle: "bold" | "clean" | "editorial";
  selectedFrameTime: number | null;
  metadata: {
    duration: number;
    width: number;
    height: number;
  } | null;
  analysis: AnalyzeResponse | null;
  videoUrl: string;
  thumbnailUrl: string | null;
};

export type StoredProjectPayload = {
  title?: string;
  headline: string;
  subtitle: string;
  presetId: string;
  accent: string;
  visualStyle: "bold" | "clean" | "editorial";
  selectedFrameTime: number | null;
  metadata: StoredProject["metadata"];
  analysis: AnalyzeResponse | null;
};
