from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ASPECTS = {
    "youtube": (1280, 720),
    "instagram": (1080, 1350),
    "tiktok": (1080, 1920),
}


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in ["arial.ttf", "DejaVuSans-Bold.ttf"]:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def _best_frame(frames: list[Path]) -> Path:
    # MVP heuristic: use frame in middle (usually less transition-heavy)
    if not frames:
        raise ValueError("No frames extracted")
    return frames[len(frames) // 2]


def build_thumbnails(frames: list[Path], title: str, out_dir: Path) -> dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    frame = _best_frame(frames)
    src = Image.open(frame).convert("RGB")

    outputs: dict[str, str] = {}

    for platform, (w, h) in ASPECTS.items():
        canvas = src.copy().resize((w, h))
        overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(overlay)

        bar_h = int(h * 0.28)
        d.rectangle([(0, h - bar_h), (w, h)], fill=(0, 0, 0, 165))

        font = _load_font(max(32, w // 18))
        text = title[:90]
        d.text((40, h - bar_h + 25), text, font=font, fill=(255, 255, 255, 255))

        merged = Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")
        out_path = out_dir / f"thumbnail_{platform}.jpg"
        merged.save(out_path, quality=92)
        outputs[platform] = str(out_path)

    return outputs
