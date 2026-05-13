import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clipcraft-project-test-"));
  process.env.CLIPCRAFT_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.CLIPCRAFT_DATA_DIR;
});

describe("project-store", () => {
  it("creates, lists, reads media, updates and deletes projects", async () => {
    const store = await import("@/lib/project-store");
    const video = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
      type: "video/mp4",
    });
    const thumbnail = new File([new Uint8Array([4, 5, 6])], "thumbnail.png", {
      type: "image/png",
    });

    const created = await store.createProject({
      video,
      thumbnail,
      payload: {
        title: "Launch Clip",
        headline: "Launch Clip",
        subtitle: "Ready",
        presetId: "youtube",
        accent: "#ff4d2e",
        visualStyle: "bold",
        selectedFrameTime: 4.2,
        metadata: { duration: 12, width: 1920, height: 1080 },
        analysis: null,
      },
    });

    expect(created.title).toBe("Launch Clip");
    expect(created.videoUrl).toContain(`/api/projects/${created.id}/video`);
    expect(created.thumbnailUrl).toContain("thumbnail");

    await expect(store.listProjects()).resolves.toHaveLength(1);
    await expect(store.getProject(created.id)).resolves.toMatchObject({
      id: created.id,
      headline: "Launch Clip",
    });

    const videoMedia = await store.getProjectMedia(created.id, "video");
    expect(videoMedia?.mimeType).toBe("video/mp4");
    expect(videoMedia?.size).toBe(3);

    const updated = await store.updateProject(created.id, {
      payload: {
        headline: "Updated",
        subtitle: "Done",
        presetId: "instagram",
      },
      thumbnail: new File([new Uint8Array([9])], "poster", { type: "" }),
    });
    expect(updated?.headline).toBe("Updated");
    expect(updated?.presetId).toBe("instagram");
    const thumbnailMedia = await store.getProjectMedia(created.id, "thumbnail");
    expect(thumbnailMedia?.mimeType).toBe("image/png");

    await expect(store.deleteProject(created.id)).resolves.toBe(true);
    await expect(store.listProjects()).resolves.toHaveLength(0);
    await expect(store.deleteProject("missing")).resolves.toBe(false);
  });

  it("handles untitled projects, missing thumbnails and missing media files", async () => {
    const store = await import("@/lib/project-store");
    const video = new File([new Uint8Array([7, 8])], "", {
      type: "video/webm",
    });

    const created = await store.createProject({
      video,
      thumbnail: null,
      payload: {
        title: "",
        headline: "",
        subtitle: "",
        presetId: "linkedin",
        accent: "#00a676",
        visualStyle: "clean",
        selectedFrameTime: 0,
        metadata: { duration: 2, width: 720, height: 1280 },
        analysis: null,
      },
    });

    expect(created.title).toBe("Unbenanntes Projekt");
    expect(created.thumbnailUrl).toBeNull();
    await expect(store.getProjectMedia(created.id, "thumbnail")).resolves.toBeNull();
    await expect(store.getProjectMedia("missing", "video")).resolves.toBeNull();

    await rm(join(dataDir, "videos", `${created.id}.webm`), { force: true });
    await expect(store.getProjectMedia(created.id, "video")).resolves.toBeNull();
  });

  it("keeps projects sorted and derives safe media extensions from mime types", async () => {
    const store = await import("@/lib/project-store");

    const mp4Project = await store.createProject({
      video: new File([new Uint8Array([1])], "capture", { type: "video/mp4" }),
      thumbnail: null,
      payload: {
        title: "MP4",
        headline: "MP4",
        subtitle: "",
        presetId: "youtube",
        accent: "#ff4d2e",
        visualStyle: "bold",
        selectedFrameTime: 0,
        metadata: { duration: 1, width: 1, height: 1 },
        analysis: null,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const fallbackProject = await store.createProject({
      video: new File([new Uint8Array([2])], "raw", { type: "application/octet-stream" }),
      thumbnail: null,
      payload: {
        title: "Fallback",
        headline: "Fallback",
        subtitle: "",
        presetId: "youtube",
        accent: "#00a676",
        visualStyle: "clean",
        selectedFrameTime: 0,
        metadata: { duration: 1, width: 1, height: 1 },
        analysis: null,
      },
    });

    const listed = await store.listProjects();
    expect(listed[0].id).toBe(fallbackProject.id);
    expect(listed.some((project) => project.id === mp4Project.id)).toBe(true);

    const pngUpdate = await store.updateProject(mp4Project.id, {
      video: new File([new Uint8Array([3])], "still", { type: "image/png" }),
      payload: {},
    });
    expect(pngUpdate?.sourceName).toBe("still");

    const jpgUpdate = await store.updateProject(mp4Project.id, {
      video: new File([new Uint8Array([4])], "still", { type: "image/jpeg" }),
      payload: {},
    });
    expect(jpgUpdate?.videoMimeType).toBe("image/jpeg");
  });

  it("updates video files, preserves existing fields and returns null for missing projects", async () => {
    const store = await import("@/lib/project-store");
    const firstVideo = new File([new Uint8Array([1])], "first.mp4", {
      type: "video/mp4",
    });
    const first = await store.createProject({
      video: firstVideo,
      thumbnail: null,
      payload: {
        title: "First",
        headline: "First",
        subtitle: "Original",
        presetId: "youtube",
        accent: "#ff4d2e",
        visualStyle: "bold",
        selectedFrameTime: 1,
        metadata: { duration: 1, width: 100, height: 100 },
        analysis: { topics: ["one"] },
      },
    });

    await expect(
      store.updateProject("missing", { payload: { headline: "Nope" } }),
    ).resolves.toBeNull();

    const quicktimeVideo = new File([new Uint8Array([2, 3, 4])], "capture", {
      type: "video/quicktime",
    });
    const updated = await store.updateProject(first.id, {
      video: quicktimeVideo,
      payload: {
        title: "  Updated   Title  ",
        analysis: null,
      },
    });

    expect(updated?.title).toBe("Updated Title");
    expect(updated?.subtitle).toBe("Original");
    expect(updated?.analysis).toBeNull();
    const media = await store.getProjectMedia(first.id, "video");
    expect(media?.mimeType).toBe("video/quicktime");
    expect(media?.size).toBe(3);
  });
});
