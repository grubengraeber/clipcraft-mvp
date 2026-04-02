# ClipCraft MVP (Auto-Thumbnail-App)

MVP für lokale Auto-Thumbnail-Generierung aus kurzen Videos (max. 30s).

## Features

- Video-Upload (max. 30 Sekunden)
- Lokale Transkription mit Whisper (`openai-whisper`)
- Regelbasierte Titel-Generierung aus Transkript
- Frame-Extraktion mit `ffmpeg`
- Thumbnail-Rendering mit Pillow (YouTube, Instagram, TikTok)
- Frontend in Deutsch/Englisch
- API-Key-Schutz zwischen Frontend und Backend (nur Server-seitiger Proxy setzt den Key)
- Einfaches Job-Status-Polling im Frontend

## Projektstruktur

- `backend/` FastAPI API + Pipeline
- `frontend/` Next.js UI + API Proxy-Routes
- `docker-compose.yml` lokales Multi-Service-Setup

## Local Start (ohne Docker)

### Voraussetzungen

- Python 3.11+
- Node.js 20+
- `ffmpeg` + `ffprobe` im PATH

### 1) Backend starten

```bash
cd backend
cp .env.example .env
# BACKEND_API_KEY anpassen!
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2) Frontend starten

```bash
cd frontend
cp .env.example .env
# BACKEND_API_KEY muss mit backend/.env identisch sein
npm install
npm run dev
```

Dann öffnen: `http://localhost:3000`

## Docker Start

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# in beiden Dateien denselben BACKEND_API_KEY setzen

docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`

## API kurz

- `POST /jobs` (multipart `video`) → `{ job_id }`
- `GET /jobs/{job_id}` → Status + Ergebnis
- `GET /files/...` → statische Thumbnail-Dateien

Backend erwartet Header: `x-api-key: <BACKEND_API_KEY>`

## Coolify Deployment (2 Services)

Empfohlen als **zwei Apps** (frontend + backend) im selben Projekt.

### Backend (FastAPI)

- Build Context: `projects/auto-thumbnail-mvp/backend`
- Dockerfile: `Dockerfile`
- Port: `8000`
- Persistenter Storage Mount: `/app/storage`
- ENV:
  - `BACKEND_API_KEY=<starkes-geheimes-token>`
  - `WHISPER_MODEL=base`
  - `MAX_VIDEO_SECONDS=30`
  - `STORAGE_DIR=storage/jobs`

### Frontend (Next.js)

- Build Context: `projects/auto-thumbnail-mvp/frontend`
- Dockerfile: `Dockerfile`
- Port: `3000`
- ENV:
  - `BACKEND_URL=http://<internal-backend-service-name>:8000`
  - `BACKEND_API_KEY=<gleiches-token-wie-backend>`
  - `NEXT_PUBLIC_BACKEND_URL=https://<deine-backend-domain>`

### Netzwerk / Domain

- Backend öffentlich oder intern erreichbar (für Bild-URLs nutzt Frontend aktuell `NEXT_PUBLIC_BACKEND_URL`)
- Frontend öffentliche Domain

## App-Name + Subdomain Vorschlag

- **App-Name:** ClipCraft
- **Subdomain:** `clipcraft.tietz-playground.com`

Alternativen:
- ThumbForge → `thumbforge.tietz-playground.com`
- SnapTitle → `snaptitle.tietz-playground.com`

## Was fehlt noch für Production Hardening

1. **Auth/Users:** Login + Mandantenfähigkeit (aktuell globaler Key)
2. **Queue/Workers:** Redis + RQ/Celery statt In-Memory-Threads
3. **Rate Limiting & Quotas:** Schutz gegen Abuse/DoS
4. **Datei-Sicherheit:** MIME-Validierung, Antivirus-Scan, strictere ffmpeg Sandbox
5. **Observability:** strukturierte Logs, Metrics, Error-Tracking
6. **Retries/Timeouts:** robuste Job-Fehlerbehandlung und Dead-letter-Strategie
7. **Storage:** S3/MinIO + Lifecycle + Signed URLs
8. **Secrets-Management:** Coolify Secrets/Vault statt `.env` auf Hosts
9. **CORS/Origin Lockdown:** aktuell MVP-offen
10. **Tests:** Unit + Integration + E2E + Lasttests
11. **Bildqualität:** besseres Frame-Ranking (Blur/Faces/Saliency)
12. **Internationalisierung:** sauber via i18n-Routing statt Inline-Copy

## Hinweise

- Keine Secrets im Repo committen (nur `.env.example` ist enthalten).
- Whisper-Modell `base` ist ein guter MVP-Kompromiss. Für schnellere lokale Runs ggf. `tiny` nutzen.
