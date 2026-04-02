import json
import subprocess
from pathlib import Path


def ffprobe_json(video_path: Path) -> dict:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(video_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def get_video_duration(video_path: Path) -> float:
    data = ffprobe_json(video_path)
    return float(data.get("format", {}).get("duration", 0))


def extract_frames(video_path: Path, out_dir: Path, every_seconds: int = 2) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    frame_pattern = out_dir / "frame_%03d.jpg"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-vf",
        f"fps=1/{every_seconds},scale=1080:-2",
        "-q:v",
        "3",
        str(frame_pattern),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return sorted(out_dir.glob("frame_*.jpg"))
