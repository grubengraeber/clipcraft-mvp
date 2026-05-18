import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { extname, join } from "node:path";

import type { StoredProject, StoredProjectPayload } from "@/lib/clipcraft";

type ProjectIndexRecord = Omit<
  StoredProject,
  "videoUrl" | "thumbnailUrl"
> & {
  videoPath: string;
  thumbnailPath: string | null;
};

const DATA_DIR =
  process.env.CLIPCRAFT_DATA_DIR ?? join(process.cwd(), ".clipcraft-data");
const INDEX_PATH = join(DATA_DIR, "projects.json");
const VIDEO_DIR = join(DATA_DIR, "videos");
const THUMBNAIL_DIR = join(DATA_DIR, "thumbnails");

export async function listProjects() {
  const projects = await readIndex();
  return projects
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .map(toClientProject);
}

export async function getProject(id: string) {
  const projects = await readIndex();
  const project = projects.find((item) => item.id === id);
  return project ? toClientProject(project) : null;
}

export async function createProject(input: {
  video: File;
  thumbnail: File | null;
  payload: StoredProjectPayload;
}) {
  await ensureStore();

  const id = randomUUID();
  const now = new Date().toISOString();
  const videoPath = join(
    VIDEO_DIR,
    `${id}${getSafeExtension(input.video.name, input.video.type, ".mp4")}`,
  );
  const thumbnailPath = input.thumbnail
    ? join(THUMBNAIL_DIR, `${id}.png`)
    : null;

  await writeUploadedFile(input.video, videoPath);
  if (input.thumbnail && thumbnailPath) {
    await writeUploadedFile(input.thumbnail, thumbnailPath);
  }

  const record: ProjectIndexRecord = {
    id,
    title: normalizeTitle(input.payload.title || input.payload.headline),
    createdAt: now,
    updatedAt: now,
    sourceName: input.video.name || "video",
    videoMimeType: input.video.type || "application/octet-stream",
    videoBytes: input.video.size,
    thumbnailMimeType: input.thumbnail?.type || null,
    headline: input.payload.headline,
    subtitle: input.payload.subtitle,
    presetId: input.payload.presetId,
    accent: input.payload.accent,
    visualStyle: input.payload.visualStyle,
    selectedFrameTime: input.payload.selectedFrameTime,
    metadata: input.payload.metadata,
    analysis: input.payload.analysis,
    videoPath,
    thumbnailPath,
  };

  const projects = await readIndex();
  projects.push(record);
  await writeIndex(projects);

  return toClientProject(record);
}

export async function updateProject(
  id: string,
  input: {
    video?: File | null;
    thumbnail?: File | null;
    payload: Partial<StoredProjectPayload>;
  },
) {
  await ensureStore();
  const projects = await readIndex();
  const index = projects.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const current = projects[index];
  const updated: ProjectIndexRecord = {
    ...current,
    updatedAt: new Date().toISOString(),
    title: normalizeTitle(
      input.payload.title || input.payload.headline || current.title,
    ),
    headline: input.payload.headline ?? current.headline,
    subtitle: input.payload.subtitle ?? current.subtitle,
    presetId: input.payload.presetId ?? current.presetId,
    accent: input.payload.accent ?? current.accent,
    visualStyle: input.payload.visualStyle ?? current.visualStyle,
    selectedFrameTime:
      input.payload.selectedFrameTime ?? current.selectedFrameTime,
    metadata: input.payload.metadata ?? current.metadata,
    analysis:
      typeof input.payload.analysis === "undefined"
        ? current.analysis
        : input.payload.analysis,
  };

  if (input.video) {
    const nextVideoPath = join(
      VIDEO_DIR,
      `${id}${getSafeExtension(input.video.name, input.video.type, ".mp4")}`,
    );
    await writeUploadedFile(input.video, nextVideoPath);
    if (nextVideoPath !== current.videoPath) {
      await rm(current.videoPath, { force: true });
    }
    updated.videoPath = nextVideoPath;
    updated.sourceName = input.video.name || current.sourceName;
    updated.videoMimeType =
      input.video.type || current.videoMimeType || "application/octet-stream";
    updated.videoBytes = input.video.size;
  }

  if (input.thumbnail) {
    const nextThumbnailPath = join(THUMBNAIL_DIR, `${id}.png`);
    await writeUploadedFile(input.thumbnail, nextThumbnailPath);
    updated.thumbnailPath = nextThumbnailPath;
    updated.thumbnailMimeType = input.thumbnail.type || "image/png";
  }

  projects[index] = updated;
  await writeIndex(projects);

  return toClientProject(updated);
}

export async function deleteProject(id: string) {
  const projects = await readIndex();
  const project = projects.find((item) => item.id === id);
  if (!project) return false;

  await Promise.allSettled([
    rm(project.videoPath, { force: true }),
    project.thumbnailPath
      ? rm(project.thumbnailPath, { force: true })
      : Promise.resolve(),
  ]);

  await writeIndex(projects.filter((item) => item.id !== id));
  return true;
}

export async function getProjectMedia(
  id: string,
  kind: "video" | "thumbnail",
) {
  const projects = await readIndex();
  const project = projects.find((item) => item.id === id);
  if (!project) return null;

  const filePath = kind === "video" ? project.videoPath : project.thumbnailPath;
  if (!filePath) return null;

  try {
    const [buffer, stats] = await Promise.all([readFile(filePath), stat(filePath)]);
    return {
      buffer,
      mimeType:
        kind === "video"
          ? project.videoMimeType
          : project.thumbnailMimeType || "image/png",
      size: stats.size,
    };
  } catch {
    return null;
  }
}

function toClientProject(project: ProjectIndexRecord): StoredProject {
  return {
    ...project,
    videoUrl: `/api/projects/${project.id}/video`,
    thumbnailUrl: project.thumbnailPath
      ? `/api/projects/${project.id}/thumbnail?updated=${encodeURIComponent(
          project.updatedAt,
        )}`
      : null,
  };
}

async function ensureStore() {
  await mkdir(VIDEO_DIR, { recursive: true });
  await mkdir(THUMBNAIL_DIR, { recursive: true });
}

async function readIndex(): Promise<ProjectIndexRecord[]> {
  await ensureStore();

  try {
    const content = await readFile(INDEX_PATH, "utf8");
    const parsed = JSON.parse(content) as ProjectIndexRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(projects: ProjectIndexRecord[]) {
  await ensureStore();
  const tempPath = `${INDEX_PATH}.tmp`;
  await writeFile(tempPath, JSON.stringify(projects, null, 2), "utf8");
  await rename(tempPath, INDEX_PATH);
}

async function writeUploadedFile(file: File, targetPath: string) {
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(tempPath, buffer);
  await copyFile(tempPath, targetPath);
  await rm(tempPath, { force: true });
}

function normalizeTitle(value: string) {
  const title = value.trim().replace(/\s+/g, " ");
  return title || "Unbenanntes Projekt";
}

function getSafeExtension(fileName: string, mimeType: string, fallback: string) {
  const extension = extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(extension)) return extension;
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("quicktime")) return ".mov";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg")) return ".jpg";
  return fallback;
}
