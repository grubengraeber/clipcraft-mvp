"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BadgeCheck,
  Captions,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  FileVideo,
  FolderOpen,
  Images,
  ImageDown,
  Languages,
  LayoutGrid,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
  WandSparkles,
} from "lucide-react";

import type {
  AnalyzeResponse,
  StoredProject,
  StoredProjectPayload,
} from "@/lib/clipcraft";
import {
  getMessages,
  localeHeader,
  type Locale,
} from "@/lib/i18n";

const MAX_DURATION_SECONDS = 60;
const MAX_CLIENT_BYTES = 200 * 1024 * 1024;

type Preset = {
  id: string;
  label: string;
  platform: string;
  width: number;
  height: number;
};

type FrameCandidate = {
  time: number;
  score: number;
  dataUrl: string;
  metrics: {
    brightness: number;
    contrast: number;
    sharpness: number;
    saturation: number;
  };
};

type SelectedFrame = FrameCandidate & {
  fullDataUrl: string;
  width: number;
  height: number;
};

type VideoMetadata = {
  duration: number;
  width: number;
  height: number;
};

type Stage = "idle" | "scanning" | "ready" | "analyzing" | "complete";
type VisualStyle = "bold" | "clean" | "editorial";
type ActiveView = "studio" | "projects";
type StudioMessages = ReturnType<typeof getMessages>["studio"];

const presets: Preset[] = [
  {
    id: "youtube",
    label: "YouTube",
    platform: "Thumbnail",
    width: 1280,
    height: 720,
  },
  {
    id: "shorts",
    label: "Shorts",
    platform: "Cover",
    width: 1080,
    height: 1920,
  },
  {
    id: "instagram",
    label: "Instagram",
    platform: "Feed",
    width: 1080,
    height: 1080,
  },
  {
    id: "preview",
    label: "Preview",
    platform: "Wide",
    width: 1200,
    height: 630,
  },
];

const accents = [
  { id: "signal", name: "Signal", value: "#ff4d2e" },
  { id: "lime", name: "Lime", value: "#b7ff4a" },
  { id: "cyan", name: "Cyan", value: "#35d7ff" },
  { id: "gold", name: "Gold", value: "#ffd166" },
  { id: "rose", name: "Rose", value: "#ff6b9a" },
];

const accentById = Object.fromEntries(
  accents.map((item) => [item.id, item.value]),
);

const styleLabels: Record<VisualStyle, string> = {
  bold: "Bold",
  clean: "Clean",
  editorial: "Editorial",
};

export function ClipCraftStudio({
  locale,
  onLocaleChange,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  const copy = getMessages(locale);
  const studioCopy = copy.studio;
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [frames, setFrames] = useState<FrameCandidate[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<SelectedFrame | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [headline, setHeadline] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [presetId, setPresetId] = useState(presets[0].id);
  const [accent, setAccent] = useState(accents[0].value);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("bold");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [copied, setCopied] = useState(false);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("studio");
  const [projectSearch, setProjectSearch] = useState("");

  const selectedPreset =
    presets.find((preset) => preset.id === presetId) ?? presets[0];
  const currentProject = projects.find((project) => project.id === currentProjectId);
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query) return projects;

    return projects.filter((project) =>
      [
        project.title,
        project.headline,
        project.subtitle,
        project.sourceName,
        project.analysis?.creative.summary,
        ...(project.analysis?.creative.keywords ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [projectSearch, projects]);
  const projectStats = useMemo(
    () => ({
      thumbnails: projects.filter((project) => project.thumbnailUrl).length,
      totalVideoBytes: projects.reduce(
        (total, project) => total + project.videoBytes,
        0,
      ),
      videos: projects.length,
    }),
    [projects],
  );

  const canAnalyze = Boolean(file && selectedFrame && stage !== "analyzing");
  const canSave = Boolean(file && selectedFrame && headline.trim() && !isSaving);
  const keywords = useMemo(
    () => analysis?.creative.keywords ?? [],
    [analysis?.creative.keywords],
  );
  const frameQuality = selectedFrame ? Math.round(selectedFrame.score) : 0;
  const aiFrameTime = analysis?.creative.selectedFrame.candidateTime;

  const statusLabel = useMemo(() => {
    return studioCopy.statuses[stage];
  }, [stage, studioCopy.statuses]);

  const resetObjectUrl = useCallback((nextUrl: string | null) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = nextUrl;
    setVideoUrl(nextUrl);
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void refreshProjects();
    // refreshProjects is a stable user action handler; locale reload is enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedFrame) return;

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      drawThumbnail(canvas, image, {
        preset: selectedPreset,
        headline: headline || studioCopy.defaultHeadline,
        subtitle:
          subtitle ||
          analysis?.creative.primaryTopic ||
          keywords.slice(0, 3).join(" / "),
        accent,
        style: visualStyle,
      });
    };
    image.src = selectedFrame.fullDataUrl;

    return () => {
      cancelled = true;
    };
  }, [
    accent,
    analysis?.creative.primaryTopic,
    headline,
    keywords,
    selectedFrame,
    selectedPreset,
    studioCopy.defaultHeadline,
    subtitle,
    visualStyle,
  ]);

  async function handleFile(nextFile: File) {
    setError("");
    setSaveMessage("");
    setCurrentProjectId(null);
    setAnalysis(null);
    setHeadline("");
    setSubtitle("");
    setFrames([]);
    setSelectedFrame(null);

    if (!nextFile.type.startsWith("video/")) {
      setError(studioCopy.errorVideoFile);
      return;
    }

    if (nextFile.size > MAX_CLIENT_BYTES) {
      setError(studioCopy.errorVideoTooLarge);
      return;
    }

    const nextUrl = URL.createObjectURL(nextFile);
    resetObjectUrl(nextUrl);
    setFile(nextFile);
    setStage("scanning");

    try {
      const nextMetadata = await readVideoMetadata(nextUrl, studioCopy);
      if (!nextMetadata.width || !nextMetadata.height) {
        throw new Error(studioCopy.errorNoReadableSignal);
      }

      if (nextMetadata.duration > MAX_DURATION_SECONDS + 0.5) {
        throw new Error(studioCopy.errorMaxDuration);
      }

      setMetadata(nextMetadata);

      const candidates = await collectFrameCandidates(
        nextUrl,
        nextMetadata,
        studioCopy,
      );
      setFrames(candidates);

      const bestFrame = candidates[0];
      const fullFrame = await captureFrame(
        nextUrl,
        bestFrame.time,
        1920,
        studioCopy,
      );
      setSelectedFrame({
        ...bestFrame,
        ...fullFrame,
      });
      setStage("ready");
    } catch (scanError) {
      setStage("idle");
      setError(
        scanError instanceof Error
          ? scanError.message
          : studioCopy.errorVideoUnreadable,
      );
    }
  }

  async function analyzeVideo() {
    if (!file) return;

    setError("");
    setStage("analyzing");

    try {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("frames", JSON.stringify(buildFramePayload(frames)));
      formData.append("durationSeconds", String(metadata?.duration ?? 0));

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: localeHeader(locale),
        body: formData,
      });
      const payload = (await response.json()) as
        | AnalyzeResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : studioCopy.errorAnalysisFailed,
        );
      }

      const result = payload as AnalyzeResponse;
      setAnalysis(result);
      setHeadline(result.creative.headline);
      setSubtitle(result.creative.subtitle);
      setVisualStyle(result.creative.visualDirection.overlayStyle);
      setAccent(
        accentById[result.creative.visualDirection.accentColor] ?? accents[0].value,
      );

      if (videoUrl) {
        const aiFrame = findClosestFrame(
          frames,
          result.creative.selectedFrame.candidateTime,
        );

        if (aiFrame) {
          const fullFrame = await captureFrame(
            videoUrl,
            aiFrame.time,
            1920,
            studioCopy,
          );
          setSelectedFrame({
            ...aiFrame,
            ...fullFrame,
          });
        }
      }

      setStage("complete");
    } catch (analysisError) {
      setStage(selectedFrame ? "ready" : "idle");
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : studioCopy.errorAnalysisFailed,
      );
    }
  }

  async function refreshProjects() {
    try {
      const response = await fetch("/api/projects", {
        cache: "no-store",
        headers: localeHeader(locale),
      });
      const payload = (await response.json()) as
        | { projects: StoredProject[] }
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : studioCopy.errorProjectsLoad,
        );
      }

      setProjects((payload as { projects: StoredProject[] }).projects);
    } catch (projectError) {
      setError(
        projectError instanceof Error
          ? projectError.message
          : studioCopy.errorProjectsLoad,
      );
    }
  }

  async function saveProject() {
    if (!file || !selectedFrame) {
      setError(studioCopy.errorSavePrereq);
      return;
    }

    setError("");
    setSaveMessage("");
    setIsSaving(true);

    try {
      const thumbnail = await canvasToBlob(canvasRef.current);
      const payload = buildProjectPayload({
        headline,
        subtitle,
        presetId,
        accent,
        visualStyle,
        selectedFrame,
        metadata,
        analysis,
        fileName: file.name,
      });
      const formData = new FormData();
      formData.append("payload", JSON.stringify(payload));
      if (!currentProjectId) {
        formData.append("video", file);
      }
      if (thumbnail) {
        formData.append("thumbnail", thumbnail, "thumbnail.png");
      }

      const endpoint = currentProjectId
        ? `/api/projects/${currentProjectId}`
        : "/api/projects";
      const response = await fetch(endpoint, {
        method: currentProjectId ? "PATCH" : "POST",
        headers: localeHeader(locale),
        body: formData,
      });
      const result = (await response.json()) as
        | { project: StoredProject }
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in result && result.error
            ? result.error
            : studioCopy.errorProjectSave,
        );
      }

      const savedProject = (result as { project: StoredProject }).project;
      setCurrentProjectId(savedProject.id);
      setSaveMessage(
        currentProjectId ? studioCopy.updatedProject : studioCopy.savedProject,
      );
      await refreshProjects();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : studioCopy.errorProjectSave,
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function loadProject(projectId: string) {
    setError("");
    setSaveMessage("");
    setIsLoadingProject(true);
    setStage("scanning");

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        cache: "no-store",
        headers: localeHeader(locale),
      });
      const payload = (await response.json()) as
        | { project: StoredProject }
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : studioCopy.errorProjectLoad,
        );
      }

      const project = (payload as { project: StoredProject }).project;
      const videoResponse = await fetch(project.videoUrl, {
        cache: "no-store",
        headers: localeHeader(locale),
      });
      if (!videoResponse.ok) {
        throw new Error(studioCopy.errorStoredVideoLoad);
      }

      const blob = await videoResponse.blob();
      const loadedFile = new File([blob], project.sourceName, {
        type: project.videoMimeType,
      });
      const nextUrl = URL.createObjectURL(loadedFile);
      resetObjectUrl(nextUrl);
      setFile(loadedFile);
      setCurrentProjectId(project.id);
      setAnalysis(project.analysis);
      setHeadline(project.headline);
      setSubtitle(project.subtitle);
      setPresetId(project.presetId);
      setAccent(project.accent);
      setVisualStyle(project.visualStyle);

      const nextMetadata =
        project.metadata ?? (await readVideoMetadata(nextUrl, studioCopy));
      setMetadata(nextMetadata);
      const candidates = await collectFrameCandidates(
        nextUrl,
        nextMetadata,
        studioCopy,
      );
      setFrames(candidates);
      const savedFrame =
        typeof project.selectedFrameTime === "number"
          ? findClosestFrame(candidates, project.selectedFrameTime)
          : null;
      const frame = savedFrame ?? candidates[0];
      const fullFrame = await captureFrame(nextUrl, frame.time, 1920, studioCopy);
      setSelectedFrame({
        ...frame,
        ...fullFrame,
      });
      setStage(project.analysis ? "complete" : "ready");
      setSaveMessage(studioCopy.loadedProject);
    } catch (loadError) {
      setStage(selectedFrame ? "ready" : "idle");
      setError(
        loadError instanceof Error
          ? loadError.message
          : studioCopy.errorProjectLoad,
      );
    } finally {
      setIsLoadingProject(false);
    }
  }

  async function openProject(projectId: string) {
    await loadProject(projectId);
    setActiveView("studio");
  }

  function startNewProject() {
    setError("");
    setSaveMessage("");
    setCurrentProjectId(null);
    setFile(null);
    resetObjectUrl(null);
    setMetadata(null);
    setFrames([]);
    setSelectedFrame(null);
    setAnalysis(null);
    setHeadline("");
    setSubtitle("");
    setPresetId(presets[0].id);
    setAccent(accents[0].value);
    setVisualStyle("bold");
    setStage("idle");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setActiveView("studio");
  }

  async function deleteCurrentProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (
      !window.confirm(
        studioCopy.deleteConfirm(
          displayProjectTitle(project?.title || "", studioCopy),
        ),
      )
    ) {
      return;
    }

    setError("");
    setSaveMessage("");

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: localeHeader(locale),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || studioCopy.errorProjectDelete);
      }

      if (currentProjectId === projectId) {
        setCurrentProjectId(null);
      }
      setSaveMessage(studioCopy.deletedProject);
      await refreshProjects();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : studioCopy.errorProjectDelete,
      );
    }
  }

  async function chooseFrame(frame: FrameCandidate) {
    if (!videoUrl) return;

    setError("");
    const fullFrame = await captureFrame(videoUrl, frame.time, 1920, studioCopy);
    setSelectedFrame({
      ...frame,
      ...fullFrame,
    });
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (nextFile) {
      void handleFile(nextFile);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) {
      void handleFile(nextFile);
    }
  }

  function downloadImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = (file?.name || "clipcraft")
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9-]+/gi, "-")
        .toLowerCase();
      link.href = url;
      link.download = `${baseName}-${selectedPreset.id}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  async function copyHeadline() {
    if (!headline) return;
    await navigator.clipboard.writeText(headline);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <main className="min-h-screen bg-[#10110f] text-[#f6f1e7]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1720px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-4 flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#b7ff4a]">
              {studioCopy.eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white sm:text-3xl">
              {studioCopy.title}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
            <nav className="flex rounded-md border border-white/10 bg-white/[0.04] p-1">
              <button
                className={[
                  "inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-semibold transition",
                  activeView === "studio"
                    ? "bg-white text-black"
                    : "text-white/65 hover:text-white",
                ].join(" ")}
                onClick={() => setActiveView("studio")}
                type="button"
              >
                <WandSparkles className="size-4" />
                {studioCopy.studioTab}
              </button>
              <button
                className={[
                  "inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-semibold transition",
                  activeView === "projects"
                    ? "bg-white text-black"
                    : "text-white/65 hover:text-white",
                ].join(" ")}
                onClick={() => {
                  setActiveView("projects");
                  void refreshProjects();
                }}
                type="button"
              >
                <LayoutGrid className="size-4" />
                {studioCopy.projectsTab}
                <span className="rounded bg-black/20 px-1.5 font-mono text-xs">
                  {projects.length}
                </span>
              </button>
            </nav>
            <StudioLanguageToggle
              copy={copy}
              locale={locale}
              onLocaleChange={onLocaleChange}
            />
            <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2">
              {stage === "analyzing" || stage === "scanning" ? (
                <Loader2 className="size-4 animate-spin text-[#35d7ff]" />
              ) : (
                <BadgeCheck className="size-4 text-[#b7ff4a]" />
              )}
              {statusLabel}
            </span>
            {metadata ? (
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 font-mono">
                {formatDuration(metadata.duration)} · {metadata.width}x
                {metadata.height}
              </span>
            ) : null}
            {currentProject ? (
              <span className="rounded-md border border-[#ffd166]/25 bg-[#ffd166]/10 px-3 py-2 text-[#ffe5a0]">
                {displayProjectTitle(currentProject.title, studioCopy)}
              </span>
            ) : null}
          </div>
        </header>

        {error ? (
          <div className="mb-4 rounded-md border border-[#ff4d2e]/40 bg-[#ff4d2e]/10 px-4 py-3 text-sm text-[#ffd7cf]">
            {error}
          </div>
        ) : null}

        {saveMessage ? (
          <div className="mb-4 rounded-md border border-[#b7ff4a]/30 bg-[#b7ff4a]/10 px-4 py-3 text-sm text-[#d8ff9b]">
            {saveMessage}
          </div>
        ) : null}

        {activeView === "projects" ? (
          <section className="rounded-lg border border-white/10 bg-[#171814] p-4">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#35d7ff]">
                  {studioCopy.projectArchive}
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-white">
                  {studioCopy.archiveTitle}
                </h2>
                <p className="mt-2 text-sm text-white/50">
                  {studioCopy.storageLocation}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm font-semibold text-white/75 transition hover:border-white/30 hover:text-white"
                  onClick={() => void refreshProjects()}
                  type="button"
                >
                  <RefreshCw className="size-4" />
                  {studioCopy.refresh}
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#b7ff4a] px-3 text-sm font-bold text-black transition hover:bg-[#d4ff8a]"
                  onClick={startNewProject}
                  type="button"
                >
                  <Plus className="size-4" />
                  {studioCopy.newVideo}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-2 flex items-center gap-2 text-white/45">
                  <Video className="size-4" />
                  <span className="text-xs uppercase tracking-[0.16em]">
                    {studioCopy.videos}
                  </span>
                </div>
                <p className="font-mono text-2xl text-white">
                  {projectStats.videos}
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-2 flex items-center gap-2 text-white/45">
                  <Images className="size-4" />
                  <span className="text-xs uppercase tracking-[0.16em]">
                    {studioCopy.thumbnails}
                  </span>
                </div>
                <p className="font-mono text-2xl text-white">
                  {projectStats.thumbnails}
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-2 flex items-center gap-2 text-white/45">
                  <FolderOpen className="size-4" />
                  <span className="text-xs uppercase tracking-[0.16em]">
                    {studioCopy.storage}
                  </span>
                </div>
                <p className="font-mono text-2xl text-white">
                  {formatBytes(projectStats.totalVideoBytes)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <label className="relative block w-full md:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/35" />
                <input
                  className="h-11 w-full rounded-md border border-white/10 bg-black/20 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#35d7ff]/60"
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder={studioCopy.searchPlaceholder}
                  type="search"
                  value={projectSearch}
                />
              </label>
              <p className="font-mono text-xs text-white/45">
                {studioCopy.projectCount(filteredProjects.length, projects.length)}
              </p>
            </div>

            {filteredProjects.length ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {filteredProjects.map((project) => {
                  const active = project.id === currentProjectId;

                  return (
                    <article
                      className={[
                        "overflow-hidden rounded-lg border bg-white/[0.03]",
                        active
                          ? "border-[#b7ff4a]/70"
                          : "border-white/10",
                      ].join(" ")}
                      key={project.id}
                    >
                      <div className="relative aspect-video bg-black">
                        {project.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={displayProjectTitle(project.title, studioCopy)}
                            className="h-full w-full object-cover"
                            src={project.thumbnailUrl}
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-white/35">
                            <FileVideo className="size-10" />
                          </div>
                        )}
                        {active ? (
                          <span className="absolute left-3 top-3 rounded bg-[#b7ff4a] px-2 py-1 text-xs font-bold text-black">
                            {studioCopy.open}
                          </span>
                        ) : null}
                      </div>

                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-semibold text-white">
                              {displayProjectTitle(project.title, studioCopy)}
                            </h3>
                            <p className="mt-1 truncate text-sm text-white/50">
                              {project.sourceName}
                            </p>
                          </div>
                          <span className="rounded-md border border-white/10 px-2 py-1 font-mono text-xs text-white/50">
                            {project.presetId}
                          </span>
                        </div>

                        <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-white/70">
                          {project.headline || studioCopy.noHeadline}
                        </p>

                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-white/45">
                          <span>
                            {formatDuration(project.metadata?.duration ?? 0)}
                          </span>
                          <span className="text-right">
                            {project.metadata
                              ? `${project.metadata.width}x${project.metadata.height}`
                              : studioCopy.noMetadata}
                          </span>
                          <span>{formatBytes(project.videoBytes)}</span>
                          <span className="text-right">
                            {formatDate(project.updatedAt)}
                          </span>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#b7ff4a] px-3 text-sm font-bold text-black transition hover:bg-[#d4ff8a]"
                            disabled={isLoadingProject}
                            onClick={() => void openProject(project.id)}
                            type="button"
                          >
                            <FolderOpen className="size-4" />
                            {studioCopy.openButton}
                          </button>
                          <a
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-white/70 transition hover:border-white/30 hover:text-white"
                            href={project.videoUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <Video className="size-4" />
                            Video
                          </a>
                          {project.thumbnailUrl ? (
                            <a
                              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-white/70 transition hover:border-white/30 hover:text-white"
                              href={project.thumbnailUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <ExternalLink className="size-4" />
                              PNG
                            </a>
                          ) : null}
                          <button
                            className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-[#ff4d2e]/25 px-3 text-sm text-[#ff9b8a] transition hover:border-[#ff4d2e]/60"
                            onClick={() => void deleteCurrentProject(project.id)}
                            type="button"
                          >
                            <Trash2 className="size-4" />
                            {studioCopy.delete}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-6 py-16 text-center">
                <LayoutGrid className="mx-auto size-10 text-white/30" />
                <h3 className="mt-4 text-lg font-semibold text-white">
                  {studioCopy.noProjectsTitle}
                </h3>
                <p className="mt-2 text-sm text-white/45">
                  {studioCopy.noProjectsBody}
                </p>
              </div>
            )}
          </section>
        ) : (
        <div className="grid flex-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)_400px]">
          <section className="rounded-lg border border-white/10 bg-[#171814] p-4">
            <div
              className={[
                "flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center transition",
                isDragging
                  ? "border-[#35d7ff] bg-[#35d7ff]/10"
                  : "border-white/20 bg-black/20 hover:border-white/40",
              ].join(" ")}
              onClick={() => inputRef.current?.click()}
              onDragLeave={() => setIsDragging(false)}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDrop={handleDrop}
            >
              <input
                ref={inputRef}
                className="hidden"
                type="file"
                accept="video/*"
                onChange={handleInputChange}
              />
              <div className="mb-4 grid size-14 place-items-center rounded-md bg-[#35d7ff]/15 text-[#35d7ff]">
                <Upload className="size-7" />
              </div>
              <p className="text-base font-semibold text-white">
                {file ? file.name : studioCopy.chooseVideo}
              </p>
              <p className="mt-2 max-w-64 text-sm leading-6 text-white/55">
                {studioCopy.uploadHint}
              </p>
              {file ? (
                <p className="mt-3 rounded-md bg-white/5 px-2 py-1 font-mono text-xs text-white/55">
                  {formatBytes(file.size)}
                </p>
              ) : null}
            </div>

            <button
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#b7ff4a] px-4 text-sm font-bold text-black transition hover:bg-[#d4ff8a] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
              disabled={!canAnalyze}
              onClick={() => void analyzeVideo()}
              type="button"
            >
              {stage === "analyzing" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <WandSparkles className="size-4" />
              )}
              {studioCopy.analyze}
            </button>

            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">
                  {studioCopy.library}
                </h2>
                <button
                  className="inline-flex size-8 items-center justify-center rounded-md border border-white/10 text-white/55 transition hover:border-white/30 hover:text-white"
                  onClick={() => void refreshProjects()}
                  type="button"
                  title={studioCopy.refresh}
                >
                  <RefreshCw className="size-4" />
                </button>
              </div>

              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                {projects.length ? (
                  projects.map((project) => {
                    const active = project.id === currentProjectId;

                    return (
                      <div
                        className={[
                          "grid grid-cols-[76px_1fr_auto] gap-2 rounded-md border p-2 transition",
                          active
                            ? "border-[#b7ff4a]/70 bg-[#b7ff4a]/10"
                            : "border-white/10 bg-white/[0.03]",
                        ].join(" ")}
                        key={project.id}
                      >
                        <button
                          className="overflow-hidden rounded bg-black"
                          onClick={() => void openProject(project.id)}
                          type="button"
                        >
                          {project.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt={displayProjectTitle(project.title, studioCopy)}
                              className="aspect-video h-full w-full object-cover"
                              src={project.thumbnailUrl}
                            />
                          ) : (
                            <span className="grid aspect-video place-items-center text-white/35">
                              <FileVideo className="size-5" />
                            </span>
                          )}
                        </button>

                        <button
                          className="min-w-0 text-left"
                          disabled={isLoadingProject}
                          onClick={() => void openProject(project.id)}
                          type="button"
                        >
                          <span className="block truncate text-sm font-semibold text-white">
                            {displayProjectTitle(project.title, studioCopy)}
                          </span>
                          <span className="mt-1 block font-mono text-[11px] text-white/45">
                            {formatDuration(project.metadata?.duration ?? 0)} ·{" "}
                            {formatBytes(project.videoBytes)}
                          </span>
                        </button>

                        <div className="flex flex-col gap-1">
                          <button
                            className="grid size-7 place-items-center rounded border border-white/10 text-white/55 transition hover:border-white/30 hover:text-white"
                            disabled={isLoadingProject}
                            onClick={() => void openProject(project.id)}
                            type="button"
                            title={studioCopy.load}
                          >
                            <FolderOpen className="size-3.5" />
                          </button>
                          <button
                            className="grid size-7 place-items-center rounded border border-[#ff4d2e]/20 text-[#ff9b8a] transition hover:border-[#ff4d2e]/60"
                            onClick={() => void deleteCurrentProject(project.id)}
                            type="button"
                            title={studioCopy.delete}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-sm text-white/45">
                    {studioCopy.noSavedProjects}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  {studioCopy.frameScan}
                </h2>
                {selectedFrame ? (
                  <span className="font-mono text-xs text-white/50">
                    {studioCopy.score} {frameQuality}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {frames.length ? (
                  frames.map((frame) => {
                    const isSelected =
                      selectedFrame &&
                      Math.abs(selectedFrame.time - frame.time) < 0.01;
                    const isAiPick =
                      typeof aiFrameTime === "number" &&
                      Math.abs(aiFrameTime - frame.time) < 0.15;

                    return (
                      <button
                        className={[
                          "group relative overflow-hidden rounded-md border bg-black text-left",
                          isSelected
                            ? "border-[#b7ff4a]"
                            : "border-white/10 hover:border-white/35",
                        ].join(" ")}
                        key={frame.time}
                        onClick={() => void chooseFrame(frame)}
                        type="button"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt={studioCopy.frameAlt(formatDuration(frame.time))}
                          className="aspect-video w-full object-cover opacity-90 transition group-hover:opacity-100"
                          src={frame.dataUrl}
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
                          {formatDuration(frame.time)}
                        </span>
                        {isAiPick ? (
                          <span className="absolute left-1 top-1 inline-flex items-center gap-1 rounded bg-[#ffd166] px-1.5 py-0.5 font-mono text-[10px] font-bold text-black">
                            <Sparkles className="size-3" />
                            AI
                          </span>
                        ) : null}
                        {isSelected ? (
                          <span className="absolute right-1 top-1 grid size-5 place-items-center rounded bg-[#b7ff4a] text-black">
                            <Check className="size-3" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="col-span-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-8 text-center text-sm text-white/45">
                    {studioCopy.noVideoLoaded}
                  </div>
                )}
              </div>
            </div>

            {videoUrl ? (
              <div className="mt-5 overflow-hidden rounded-lg border border-white/10 bg-black">
                <video
                  className="aspect-video w-full object-contain"
                  controls
                  muted
                  playsInline
                  src={videoUrl}
                />
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-white/10 bg-[#ebe5d7] p-4 text-[#171814]">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{studioCopy.exportPreview}</h2>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/50">
                  {selectedPreset.width}x{selectedPreset.height} ·{" "}
                  {selectedPreset.platform}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    className={[
                      "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition",
                      preset.id === presetId
                        ? "border-black bg-black text-white"
                        : "border-black/15 bg-white/55 text-black hover:border-black/40",
                    ].join(" ")}
                    key={preset.id}
                    onClick={() => setPresetId(preset.id)}
                    type="button"
                  >
                    <ImageDown className="size-4" />
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="relative mx-auto grid w-full max-w-[920px] place-items-center rounded-lg border border-black/10 bg-[#1a1a17] p-3"
              style={{
                aspectRatio: `${selectedPreset.width} / ${selectedPreset.height}`,
              }}
            >
              <canvas
                ref={canvasRef}
                className="h-full max-h-full w-full max-w-full rounded-md object-contain shadow-2xl shadow-black/30"
              />
              {!selectedFrame ? (
                <div className="absolute flex flex-col items-center gap-3 text-white/45">
                  <FileVideo className="size-10" />
                  <span className="text-sm">{studioCopy.noPreview}</span>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label
                    className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-black/50"
                    htmlFor="headline"
                  >
                    {studioCopy.headline}
                  </label>
                  <textarea
                    className="min-h-24 w-full min-w-0 resize-none rounded-md border border-black/15 bg-white px-3 py-2 text-xl font-black uppercase leading-tight outline-none transition focus:border-black"
                    id="headline"
                    maxLength={72}
                    onChange={(event) => setHeadline(event.target.value)}
                    placeholder={studioCopy.headline}
                    value={headline}
                  />
                </div>

                <div>
                  <label
                    className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-black/50"
                    htmlFor="subtitle"
                  >
                    {studioCopy.subline}
                  </label>
                  <textarea
                    className="min-h-24 w-full min-w-0 resize-none rounded-md border border-black/15 bg-white px-3 py-2 text-base font-semibold leading-snug outline-none transition focus:border-black"
                    id="subtitle"
                    maxLength={120}
                    onChange={(event) => setSubtitle(event.target.value)}
                    placeholder={studioCopy.subline}
                    value={subtitle}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-4 text-sm font-semibold transition hover:border-black/40"
                  disabled={!headline}
                  onClick={() => void copyHeadline()}
                  type="button"
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Clipboard className="size-4" />
                  )}
                  {copied ? studioCopy.copied : studioCopy.headline}
                </button>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-4 text-sm font-semibold transition hover:border-black/40 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!canSave}
                  onClick={() => void saveProject()}
                  type="button"
                >
                  {isSaving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  {currentProjectId ? studioCopy.update : studioCopy.save}
                </button>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white transition hover:bg-[#2c2c27] disabled:cursor-not-allowed disabled:bg-black/20"
                  disabled={!selectedFrame}
                  onClick={downloadImage}
                  type="button"
                >
                  <Download className="size-4" />
                  PNG
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                {accents.map((item) => (
                  <button
                    aria-label={item.name}
                    className={[
                      "grid size-9 place-items-center rounded-md border transition",
                      accent === item.value
                        ? "border-black"
                        : "border-black/10 hover:border-black/35",
                    ].join(" ")}
                    key={item.value}
                    onClick={() => setAccent(item.value)}
                    type="button"
                  >
                    <span
                      className="size-5 rounded-sm"
                      style={{ backgroundColor: item.value }}
                    />
                  </button>
                ))}
              </div>

              <div className="flex rounded-md border border-black/15 bg-white p-1">
                {Object.entries(styleLabels).map(([value, label]) => (
                  <button
                    className={[
                      "h-8 rounded px-3 text-sm font-semibold transition",
                      visualStyle === value
                        ? "bg-black text-white"
                        : "text-black/55 hover:text-black",
                    ].join(" ")}
                    key={value}
                    onClick={() => setVisualStyle(value as VisualStyle)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="rounded-lg border border-white/10 bg-[#171814] p-4">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="size-5 text-[#ffd166]" />
              <h2 className="text-lg font-semibold text-white">
                {studioCopy.creativeBrief}
              </h2>
            </div>

            {analysis ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    {studioCopy.topic}
                  </p>
                  <p className="text-sm leading-6 text-white/80">
                    {analysis.creative.summary}
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    {studioCopy.aiFrame}
                  </p>
                  <div className="rounded-md border border-[#ffd166]/25 bg-[#ffd166]/10 p-3">
                    <p className="font-mono text-xs text-[#ffd166]">
                      {formatDuration(analysis.creative.selectedFrame.candidateTime)} ·{" "}
                      {studioCopy.score}{" "}
                      {Math.round(analysis.creative.selectedFrame.visualScore)}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {analysis.creative.selectedFrame.visibleMoment}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/65">
                      {analysis.creative.selectedFrame.rationale}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    {studioCopy.keywords}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {keywords.map((keyword) => (
                      <span
                        className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white/75"
                        key={keyword}
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    {studioCopy.alternatives}
                  </p>
                  <div className="space-y-2">
                    {analysis.creative.titleAlternatives.map((title) => (
                      <button
                        className="flex w-full items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-white/75 transition hover:border-white/30"
                        key={title}
                        onClick={() => setHeadline(title)}
                        type="button"
                      >
                        <span>{title}</span>
                        <Play className="size-3 text-[#b7ff4a]" />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    {studioCopy.frameHints}
                  </p>
                  <p className="text-sm leading-6 text-white/75">
                    {analysis.creative.visualDirection.focalPoint}
                  </p>
                  <ul className="mt-2 space-y-2 text-sm text-white/55">
                    {analysis.creative.visualDirection.frameHints.map((hint) => (
                      <li className="flex gap-2" key={hint}>
                        <span className="mt-2 size-1.5 rounded-sm bg-[#35d7ff]" />
                        <span>{hint}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    <Captions className="size-4" />
                    {studioCopy.transcript}
                  </p>
                  <div className="max-h-52 overflow-auto rounded-md border border-white/10 bg-black/25 p-3 text-sm leading-6 text-white/70">
                    {analysis.transcript}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/55">
                {studioCopy.noAnalysis}
              </div>
            )}
          </aside>
        </div>
        )}
      </div>
    </main>
  );
}

function StudioLanguageToggle({
  copy,
  locale,
  onLocaleChange,
}: {
  copy: ReturnType<typeof getMessages>;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  return (
    <div
      aria-label={copy.locale.label}
      className="inline-flex h-10 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] p-1"
      role="group"
    >
      <Languages className="mx-1 size-4 text-white/50" />
      {(["de", "en"] as const).map((item) => (
        <button
          className={[
            "h-8 rounded px-2 text-xs font-bold transition",
            locale === item
              ? "bg-white text-black"
              : "text-white/55 hover:text-white",
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

function displayProjectTitle(title: string, messages: StudioMessages) {
  return title && title !== "Unbenanntes Projekt" ? title : messages.unnamed;
}

async function readVideoMetadata(
  src: string,
  messages: StudioMessages,
): Promise<VideoMetadata> {
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = src;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error(messages.errorMetadata));
  });

  return {
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
  };
}

async function collectFrameCandidates(
  src: string,
  metadata: VideoMetadata,
  messages: StudioMessages,
): Promise<FrameCandidate[]> {
  const video = await createLoadedVideo(src, messages);
  const sampleCount = Math.min(18, Math.max(8, Math.round(metadata.duration / 4) + 6));
  const start = Math.min(1, metadata.duration * 0.08);
  const end = Math.max(start + 0.1, metadata.duration * 0.92);
  const times = Array.from({ length: sampleCount }, (_, index) => {
    if (sampleCount === 1) return metadata.duration / 2;
    return start + ((end - start) * index) / (sampleCount - 1);
  });

  const aspect = metadata.width / metadata.height;
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = Math.round(canvas.width / aspect);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error(messages.errorCanvas);
  }

  const candidates: FrameCandidate[] = [];

  for (const time of times) {
    await seekVideo(video, time, messages);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const metrics = scoreFrame(imageData);

    candidates.push({
      time,
      score: metrics.score,
      dataUrl: canvas.toDataURL("image/jpeg", 0.82),
      metrics: {
        brightness: metrics.brightness,
        contrast: metrics.contrast,
        sharpness: metrics.sharpness,
        saturation: metrics.saturation,
      },
    });
  }

  disposeVideo(video);

  return candidates.sort((a, b) => b.score - a.score).slice(0, 9);
}

async function captureFrame(
  src: string,
  time: number,
  maxWidth: number,
  messages: StudioMessages,
) {
  const video = await createLoadedVideo(src, messages);
  await seekVideo(video, time, messages);

  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(messages.errorCanvas);
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const fullDataUrl = canvas.toDataURL("image/jpeg", 0.92);
  disposeVideo(video);

  return {
    fullDataUrl,
    width: canvas.width,
    height: canvas.height,
  };
}

async function createLoadedVideo(src: string, messages: StudioMessages) {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = src;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error(messages.errorVideoLoad));
  });

  return video;
}

function seekVideo(
  video: HTMLVideoElement,
  time: number,
  messages: StudioMessages,
) {
  return new Promise<void>((resolve, reject) => {
    const clampedTime = Math.min(
      Math.max(time, 0),
      Math.max(0, video.duration - 0.05),
    );
    const timeout = window.setTimeout(() => {
      reject(new Error(messages.errorFrameTimeout));
    }, 4000);

    const done = () => {
      window.clearTimeout(timeout);
      resolve();
    };

    video.addEventListener("seeked", done, { once: true });
    video.currentTime = clampedTime;
  });
}

function disposeVideo(video: HTMLVideoElement) {
  video.removeAttribute("src");
  video.load();
}

function buildProjectPayload(input: {
  headline: string;
  subtitle: string;
  presetId: string;
  accent: string;
  visualStyle: VisualStyle;
  selectedFrame: SelectedFrame;
  metadata: VideoMetadata | null;
  analysis: AnalyzeResponse | null;
  fileName: string;
}): StoredProjectPayload {
  const cleanHeadline = input.headline.trim();

  return {
    title: cleanHeadline || input.fileName.replace(/\.[^.]+$/, ""),
    headline: cleanHeadline,
    subtitle: input.subtitle.trim(),
    presetId: input.presetId,
    accent: input.accent,
    visualStyle: input.visualStyle,
    selectedFrameTime: input.selectedFrame.time,
    metadata: input.metadata,
    analysis: input.analysis,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement | null) {
  return new Promise<Blob | null>((resolve) => {
    if (!canvas) {
      resolve(null);
      return;
    }

    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

function buildFramePayload(frames: FrameCandidate[]) {
  return frames.slice(0, 8).map((frame) => ({
    time: Number(frame.time.toFixed(2)),
    score: Number(frame.score.toFixed(2)),
    dataUrl: frame.dataUrl,
    metrics: {
      brightness: Number(frame.metrics.brightness.toFixed(2)),
      contrast: Number(frame.metrics.contrast.toFixed(2)),
      sharpness: Number(frame.metrics.sharpness.toFixed(2)),
      saturation: Number(frame.metrics.saturation.toFixed(3)),
    },
  }));
}

function findClosestFrame(frames: FrameCandidate[], time: number) {
  if (!frames.length) return null;

  return frames.reduce((closest, frame) =>
    Math.abs(frame.time - time) < Math.abs(closest.time - time)
      ? frame
      : closest,
  );
}

function scoreFrame(imageData: ImageData) {
  const { data, width, height } = imageData;
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let saturationSum = 0;
  let samples = 0;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturation = max === 0 ? 0 : (max - min) / max;

      lumaSum += luma;
      lumaSquaredSum += luma * luma;
      saturationSum += saturation;
      samples += 1;
    }
  }

  let edgeSum = 0;
  let edgeSamples = 0;

  for (let y = 2; y < height - 2; y += 3) {
    for (let x = 2; x < width - 2; x += 3) {
      const center = lumaAt(data, width, x, y);
      const right = lumaAt(data, width, x + 1, y);
      const down = lumaAt(data, width, x, y + 1);
      edgeSum += Math.abs(center - right) + Math.abs(center - down);
      edgeSamples += 1;
    }
  }

  const brightness = lumaSum / samples;
  const variance = lumaSquaredSum / samples - brightness * brightness;
  const contrast = Math.sqrt(Math.max(0, variance));
  const saturation = saturationSum / samples;
  const sharpness = edgeSum / edgeSamples;
  const exposureScore = clamp(1 - Math.abs(brightness - 118) / 118, 0, 1);
  const darkPenalty = brightness < 32 ? (32 - brightness) / 32 : 0;
  const blownPenalty = brightness > 236 ? (brightness - 236) / 19 : 0;

  const score =
    (clamp(sharpness / 24, 0, 1) * 0.45 +
      clamp(contrast / 72, 0, 1) * 0.24 +
      clamp(saturation / 0.52, 0, 1) * 0.17 +
      exposureScore * 0.14 -
      darkPenalty * 0.35 -
      blownPenalty * 0.2) *
    100;

  return {
    brightness,
    contrast,
    saturation,
    sharpness,
    score: clamp(score, 0, 100),
  };
}

function lumaAt(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const index = (y * width + x) * 4;
  return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
}

function drawThumbnail(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  options: {
    preset: Preset;
    headline: string;
    subtitle: string;
    accent: string;
    style: VisualStyle;
  },
) {
  const { preset, headline, subtitle, accent, style } = options;
  canvas.width = preset.width;
  canvas.height = preset.height;

  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  const portrait = height > width;
  const square = width === height;
  const imageLayout = getImageLayoutMode(image, width, height);

  context.fillStyle = "#11110f";
  context.fillRect(0, 0, width, height);
  drawImageScene(context, image, width, height, imageLayout);

  context.fillStyle =
    style === "clean"
      ? "rgba(0,0,0,0.16)"
      : imageLayout.safeFit
        ? "rgba(0,0,0,0.18)"
        : "rgba(0,0,0,0.28)";
  context.fillRect(0, 0, width, height);

  const gradient = context.createLinearGradient(
    0,
    height * (portrait ? 0.18 : 0.22),
    0,
    height,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.58, "rgba(0,0,0,0.34)");
  gradient.addColorStop(1, "rgba(0,0,0,0.9)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  if (style === "editorial") {
    context.fillStyle = "rgba(246, 241, 231, 0.92)";
    context.fillRect(0, height * 0.71, width, height * 0.29);
  }

  const align: CanvasTextAlign = portrait || square ? "center" : "left";
  const maxTextWidth =
    width *
    (imageLayout.safeFit && imageLayout.foregroundSide === "right"
      ? 0.5
      : portrait
        ? 0.82
        : square
          ? 0.78
          : 0.64);
  const maxLines = portrait ? 4 : 3;
  const initialFontSize = Math.round(
    width *
      (imageLayout.safeFit && imageLayout.foregroundSide === "right"
        ? 0.073
        : portrait
          ? 0.118
          : 0.085),
  );
  const minFontSize = Math.round(width * 0.04);
  const title = headline.trim().toUpperCase();
  const textColor = style === "editorial" ? "#11110f" : "#fff8ea";
  const shadowColor =
    style === "editorial" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.72)";

  const titleFit = fitText(context, title, {
    maxWidth: maxTextWidth,
    maxLines,
    initialFontSize,
    minFontSize,
    weight: 950,
    family: "Arial Black, Impact, sans-serif",
  });
  const lineHeight = titleFit.fontSize * (portrait ? 0.96 : 0.92);
  const blockHeight = titleFit.lines.length * lineHeight;
  const textX = align === "center" ? width / 2 : width * 0.075;
  const titleY = height - height * (portrait ? 0.12 : 0.13) - blockHeight;
  const accentX = align === "center" ? width * 0.18 : textX - width * 0.025;

  context.fillStyle = accent;
  if (align === "center") {
    context.fillRect(
      width * 0.28,
      titleY - height * 0.035,
      width * 0.44,
      height * 0.008,
    );
  } else {
    context.fillRect(accentX, titleY, width * 0.011, blockHeight);
  }

  const pillText = subtitle.trim().toUpperCase();
  if (pillText) {
    drawPill(context, {
      text: pillText,
      x: textX,
      y: Math.max(height * 0.07, titleY - height * 0.09),
      maxWidth: maxTextWidth,
      align,
      accent,
      style,
      canvasWidth: width,
    });
  }

  context.textAlign = align;
  context.textBaseline = "top";
  context.font = `950 ${titleFit.fontSize}px Arial Black, Impact, sans-serif`;
  context.lineJoin = "round";
  context.shadowColor = shadowColor;
  context.shadowBlur = style === "editorial" ? 0 : Math.round(width * 0.018);
  context.shadowOffsetY = Math.round(width * 0.006);

  titleFit.lines.forEach((line, index) => {
    const y = titleY + index * lineHeight;
    if (style !== "editorial") {
      context.strokeStyle = "rgba(0,0,0,0.78)";
      context.lineWidth = Math.max(8, titleFit.fontSize * 0.08);
      context.strokeText(line, textX, y, maxTextWidth);
    }
    context.fillStyle = textColor;
    context.fillText(line, textX, y, maxTextWidth);
  });

  context.shadowColor = "transparent";
  context.fillStyle = accent;
  context.fillRect(
    width * 0.04,
    height * 0.045,
    width * 0.09,
    Math.max(7, height * 0.009),
  );
}

function getImageLayoutMode(
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const canvasAspect = width / height;
  const imageAspect = image.width / image.height;
  const mismatch = Math.abs(Math.log(canvasAspect / imageAspect));
  const safeFit = mismatch > 0.42;
  const foregroundSide =
    safeFit && canvasAspect > 1.2 && imageAspect < canvasAspect
      ? "right"
      : "center";

  return {
    canvasAspect,
    foregroundSide,
    imageAspect,
    safeFit,
  };
}

function drawImageScene(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  layout: ReturnType<typeof getImageLayoutMode>,
) {
  if (!layout.safeFit) {
    drawImageCover(context, image, width, height);
    return;
  }

  context.save();
  context.filter = "blur(28px) saturate(1.2) brightness(0.82)";
  drawImageCover(context, image, width, height, 1.12);
  context.restore();

  context.save();
  context.fillStyle = "rgba(0,0,0,0.34)";
  context.fillRect(0, 0, width, height);
  context.restore();

  const rect = getSafeContainRect(image, width, height, layout.foregroundSide);

  context.save();
  context.shadowColor = "rgba(0,0,0,0.46)";
  context.shadowBlur = Math.round(width * 0.022);
  context.shadowOffsetY = Math.round(height * 0.018);
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

function getSafeContainRect(
  image: HTMLImageElement,
  width: number,
  height: number,
  side: string,
) {
  const imageAspect = image.width / image.height;
  const paddingX = width * 0.045;
  const paddingY = height * 0.025;
  const maxWidth = width - paddingX * 2;
  const maxHeight = height - paddingY * 2;
  let targetWidth = maxWidth;
  let targetHeight = targetWidth / imageAspect;

  if (targetHeight > maxHeight) {
    targetHeight = maxHeight;
    targetWidth = targetHeight * imageAspect;
  }

  const x =
    side === "right"
      ? width - paddingX - targetWidth
      : (width - targetWidth) / 2;
  const y = (height - targetHeight) / 2;

  return {
    height: targetHeight,
    width: targetWidth,
    x,
    y,
  };
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  overscan = 1,
) {
  const scale = Math.max(width / image.width, height / image.height) * overscan;
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
}

function drawPill(
  context: CanvasRenderingContext2D,
  options: {
    text: string;
    x: number;
    y: number;
    maxWidth: number;
    align: CanvasTextAlign;
    accent: string;
    style: VisualStyle;
    canvasWidth: number;
  },
) {
  const fontSize = Math.max(18, Math.round(options.canvasWidth * 0.025));
  context.font = `800 ${fontSize}px Arial, sans-serif`;
  const text = trimToWidth(context, options.text, options.maxWidth * 0.86);
  const metrics = context.measureText(text);
  const paddingX = fontSize * 0.72;
  const paddingY = fontSize * 0.42;
  const pillWidth = metrics.width + paddingX * 2;
  const pillHeight = fontSize + paddingY * 2;
  const pillX =
    options.align === "center" ? options.x - pillWidth / 2 : options.x;

  context.save();
  context.fillStyle = options.style === "editorial" ? options.accent : "rgba(0,0,0,0.76)";
  roundRect(context, pillX, options.y, pillWidth, pillHeight, Math.min(8, fontSize * 0.38));
  context.fill();
  context.fillStyle = options.style === "editorial" ? "#11110f" : options.accent;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(text, pillX + paddingX, options.y + pillHeight / 2);
  context.restore();
}

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  options: {
    maxWidth: number;
    maxLines: number;
    initialFontSize: number;
    minFontSize: number;
    weight: number;
    family: string;
  },
) {
  for (
    let fontSize = options.initialFontSize;
    fontSize >= options.minFontSize;
    fontSize -= 2
  ) {
    context.font = `${options.weight} ${fontSize}px ${options.family}`;
    const lines = wrapText(context, text, options.maxWidth);
    if (lines.length <= options.maxLines) {
      return { fontSize, lines };
    }
  }

  context.font = `${options.weight} ${options.minFontSize}px ${options.family}`;
  const lines = wrapText(context, text, options.maxWidth).slice(0, options.maxLines);
  const lastLine = lines[lines.length - 1] ?? "";
  lines[lines.length - 1] = trimToWidth(context, lastLine, options.maxWidth);

  return { fontSize: options.minFontSize, lines };
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const chunks = splitLongWord(context, word, maxWidth);
    for (const chunk of chunks) {
      const testLine = line ? `${line} ${chunk}` : chunk;
      if (context.measureText(testLine).width <= maxWidth) {
        line = testLine;
      } else {
        if (line) lines.push(line);
        line = chunk;
      }
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

function splitLongWord(
  context: CanvasRenderingContext2D,
  word: string,
  maxWidth: number,
) {
  if (context.measureText(word).width <= maxWidth) return [word];

  const chunks: string[] = [];
  let chunk = "";

  for (const char of word) {
    const testChunk = `${chunk}${char}`;
    if (context.measureText(testChunk).width <= maxWidth) {
      chunk = testChunk;
    } else {
      if (chunk) chunks.push(chunk);
      chunk = char;
    }
  }

  if (chunk) chunks.push(chunk);
  return chunks;
}

function trimToWidth(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (context.measureText(text).width <= maxWidth) return text;

  let trimmed = text;
  while (trimmed.length > 1 && context.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed.trim()}...`;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
