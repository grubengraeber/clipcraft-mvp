import re

STOPWORDS = {
    "und",
    "oder",
    "aber",
    "ich",
    "du",
    "wir",
    "der",
    "die",
    "das",
    "ein",
    "eine",
    "mit",
    "für",
    "this",
    "that",
    "with",
    "from",
    "your",
    "about",
}


def _keywords(text: str) -> list[str]:
    words = re.findall(r"[A-Za-zÄÖÜäöüß0-9]{3,}", text.lower())
    words = [w for w in words if w not in STOPWORDS]
    freq: dict[str, int] = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1
    return [k for k, _ in sorted(freq.items(), key=lambda x: x[1], reverse=True)[:4]]


def catchy_title(transcript: str) -> str:
    transcript = transcript.strip()
    if not transcript:
        return "Must-Watch Tech Clip 🚀"
    keys = _keywords(transcript)
    if not keys:
        preview = " ".join(transcript.split()[:6])
        return f"{preview}... 👀"
    phrase = " | ".join(k.upper() for k in keys[:3])
    return f"{phrase} – Das musst du sehen!"
