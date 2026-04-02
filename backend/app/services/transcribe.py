from pathlib import Path
import whisper


def transcribe_video(video_path: Path, model_name: str = "base") -> str:
    model = whisper.load_model(model_name)
    result = model.transcribe(str(video_path), fp16=False)
    return (result.get("text") or "").strip()
