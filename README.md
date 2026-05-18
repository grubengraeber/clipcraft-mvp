# ClipCraft Studio

ClipCraft ist eine Next.js-App fuer kurze Social-Videos: schneller First-Run,
Plan-Auswahl, Checkout, AI-Transkript, Creative Brief, Frame-Scan, Thumbnail-
Composer, PNG-Export und lokales Projektarchiv.

## Funktionen

- Onboarding fuer neue Nutzer mit Workspace, Rolle, Workflow und Brand Accent
- Getrennte Seiten fuer Login (`/login`) und Registrierung (`/register`)
- Passwortlose Anmeldung per E-Mail-OTP und HTTP-only Session-Cookie
- Vollstaendige Deutsch/Englisch-Umschaltung fuer UX, OTP-E-Mail und API-Fehler
- Billing-Gate vor Analyse und Speichern
- Stripe Checkout fuer echte Subscriptions, sobald Stripe-ENV gesetzt ist
- Lokaler Testmodus ohne Stripe-Keys, damit die App sofort nutzbar bleibt
- Eigene Produktflaechen fuer Studio (`/studio`), Projektarchiv (`/projects`) und Settings (`/settings`)
- OpenAI-Transkription mit `gpt-4o-mini-transcribe`
- Multimodale Creative-Analyse mit `gpt-5`
- Clientseitiger Frame-Scan nach Schaerfe, Kontrast, Helligkeit und Saettigung
- Canvas-Composer fuer YouTube, Shorts, Instagram und Wide Preview
- CRUD-Bibliothek fuer Videos, Thumbnails, Headlines, Presets und Analyse-Daten
- Lokale Usage-Erfassung fuer Minuten und PNG-Exports

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Dann `http://localhost:3000` oeffnen.

Fuer AI-Analyse muss `OPENAI_API_KEY` in `frontend/.env.local` gesetzt sein.
Ohne `RESEND_API_KEY` zeigt die App den OTP-Code lokal im Login-Screen an.
Ohne Stripe-Konfiguration startet die App im lokalen Testzahlungsmodus.
Die Sprache kann in Login, Onboarding und Studio zwischen Deutsch und Englisch
umgeschaltet werden; API-Calls senden das aktive Locale mit.

## Env

```bash
OPENAI_API_KEY=sk-proj-...

# Optional:
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_TEXT_MODEL=gpt-5
FFMPEG_PATH=/usr/local/bin/ffmpeg
CLIPCRAFT_DATA_DIR=/Users/name/ClipCraft-Storage

# Optional passwordless OTP email delivery:
RESEND_API_KEY=re_...
OTP_EMAIL_FROM=ClipCraft <login@your-domain.com>

# Optional Stripe Checkout:
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_CREATOR=price_...
STRIPE_PRICE_STUDIO=price_...
```

## Stripe

Wenn `STRIPE_SECRET_KEY` plus mindestens `STRIPE_PRICE_CREATOR` gesetzt ist,
erstellt `/api/billing/checkout` eine gehostete Stripe Checkout Session im
Subscription-Modus. Nach erfolgreichem Checkout bestaetigt
`/api/billing/confirm` die Session; `/api/billing/webhook` verarbeitet
`checkout.session.completed` und Subscription-Updates mit Signaturpruefung.

Ohne Stripe-Keys aktiviert der Button im Payment-Step ein lokales Test-Abo.
Das ist fuer lokale Nutzung und UX-Tests gedacht und verarbeitet keine echte
Kartenzahlung.

## Login und Registrierung

Neue Nutzer starten auf `/register` mit Name, Workspace, E-Mail und einem
sechsstelligen Code. Bestehende Nutzer melden sich auf `/login` mit E-Mail und
Code an. In lokaler Entwicklung ohne `RESEND_API_KEY` gibt
`/api/auth/otp/request` den Code nur fuer den Testmodus zurueck, und die UI
zeigt ihn direkt an. Sobald `RESEND_API_KEY` gesetzt ist, sendet ClipCraft den
Code per Resend und gibt keinen Code mehr an den Browser zurueck.

Nach erfolgreicher Verifikation setzt `/api/auth/otp/verify` ein HTTP-only
Cookie (`clipcraft_session`). Onboarding, Checkout, Analyse und Projektarchiv
akzeptieren nur diese Session; die verifizierte E-Mail bleibt waehrend des
Onboardings die Account-Identitaet.

## Internationalisierung

Die App nutzt `frontend/src/lib/i18n.ts` als gemeinsame Message-Quelle fuer
Client und API. Der Sprachumschalter speichert `clipcraft_locale` im Browser und
sendet `x-clipcraft-locale` an API-Routen, damit Fehlermeldungen, OTP-E-Mails,
lokaler Analyse-Fallback und Payment-/Projektmeldungen in derselben Sprache
antworten.

## Lokaler Speicher

Gespeicherte Daten liegen standardmaessig in `frontend/.clipcraft-data/`:

- `account.json` enthaelt Onboarding-, Billing- und Usage-Status
- `projects.json` enthaelt Projektmetadaten
- `videos/` enthaelt Originalvideos
- `thumbnails/` enthaelt PNG-Exports

Der Speicherort kann mit `CLIPCRAFT_DATA_DIR` ueberschrieben werden.

## Verifikation

```bash
cd frontend
npm run lint
npm run build
npm run test:coverage
npm run screenshot:audit
```

`npm run test:coverage` nutzt Vitest/V8 und erzwingt mindestens 80% fuer
Statements, Branches, Functions und Lines auf den kritischen Store-/Auth-Libs.

`npm run screenshot:audit` startet nach einem vorhandenen Build automatisch
`next start` auf Port `3210`, klickt mit Playwright durch Login, Registrierung,
Onboarding, lokale Testzahlung, Studio, Projektarchiv und Settings und schreibt
PNGs nach `frontend/artifacts/screenshots/`. Ohne vorhandenen Build faellt der
Audit auf `next dev` zurueck. Mit `SCREENSHOT_BASE_URL=http://localhost:3001`
kann eine bereits laufende App geprueft werden.

## Docker

```bash
cp frontend/.env.example frontend/.env
docker compose up --build
```

Die App laeuft dann auf `http://localhost:3000`.

## Projektstruktur

- `frontend/` vollstaendige ClipCraft Studio App
- `frontend/src/app/login`, `register`, `studio`, `projects`, `settings` eigenstaendige Produktseiten
- `frontend/src/app/api/account` Account und Onboarding
- `frontend/src/app/api/billing` Checkout, Confirm, Portal und Webhook
- `frontend/src/app/api/analyze` OpenAI/FFmpeg Analyse
- `frontend/src/app/api/projects` Projektarchiv und Medien
- `backend/` alter FastAPI-MVP, bleibt zur Referenz im Repo, wird von der neuen App nicht benoetigt
