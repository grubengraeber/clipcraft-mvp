from __future__ import annotations

import json
import shutil
import threading
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .models import CreateJobResponse, JobStatusResponse
from .services.thumbnail_tools import build_thumbnails
from .services.title_tools import catchy_title
from .services.transcribe import transcribe_video
from .services.video_tools import extract_frames, get_video_duration

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage = Path(settings.storage_dir)
storage.mkdir(parents=True, exist_ok=True)

app.mount("/files", StaticFiles(directory=storage), name="files")


JOBS: dict[str, dict] = {}
LOCK = threading.Lock()


def check_api_key(x_api_key: str = Header(default="")) -> None:
    if x_api_key != settings.backend_api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


def _save_job(job_id: str, payload: dict) -> None:
    with LOCK:
        JOBS[job_id] = payload
    job_file = storage / job_id / "job.json"
    job_file.parent.mkdir(parents=True, exist_ok=True)
    job_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _process_job(job_id: str, video_path: Path) -> None:
    try:
        _save_job(job_id, {"status": "processing", "error": None})

        transcript = transcribe_video(video_path, settings.whisper_model)
        title = catchy_title(transcript)
        frames = extract_frames(video_path, storage / job_id / "frames")
        thumbs = build_thumbnails(frames, title, storage / job_id)

        thumbs_rel = {
            k: f"/files/{job_id}/{Path(v).name}" for k, v in thumbs.items()
        }
        _save_job(
            job_id,
            {
                "status": "done",
                "error": None,
                "transcript": transcript,
                "title": title,
                "thumbnails": thumbs_rel,
            },
        )
    except Exception as e:
        _save_job(job_id, {"status": "error", "error": str(e)})


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/jobs", response_model=CreateJobResponse, dependencies=[Depends(check_api_key)])
async def create_job(video: UploadFile = File(...)):
    job_id = str(uuid.uuid4())
    job_dir = storage / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    video_path = job_dir / "input.mp4"

    with video_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)

    duration = get_video_duration(video_path)
    if duration > settings.max_video_seconds:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Video too long ({duration:.1f}s). Max is {settings.max_video_seconds}s")

    _save_job(job_id, {"status": "queued", "error": None})
    t = threading.Thread(target=_process_job, args=(job_id, video_path), daemon=True)
    t.start()
    return CreateJobResponse(job_id=job_id)


@app.get("/jobs/{job_id}", response_model=JobStatusResponse, dependencies=[Depends(check_api_key)])
def get_job(job_id: str):
    job_file = storage / job_id / "job.json"
    if not job_file.exists():
        raise HTTPException(status_code=404, detail="Job not found")
    data = json.loads(job_file.read_text(encoding="utf-8"))
    return JobStatusResponse(job_id=job_id, **data)
