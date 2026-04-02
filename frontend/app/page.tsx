'use client';

import { useEffect, useMemo, useState } from 'react';

type JobData = {
  job_id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  error?: string;
  transcript?: string;
  title?: string;
  thumbnails?: Record<string, string>;
};

const copy = {
  de: {
    title: 'ClipCraft',
    subtitle: 'Lade ein kurzes Video hoch (max. 30s) und erhalte Transkript, Titel & Thumbnail-Vorschläge.',
    upload: 'Video auswählen',
    start: 'Generieren',
    processing: 'Verarbeitung läuft',
    transcript: 'Transkript',
    generatedTitle: 'Titelvorschlag',
    thumbs: 'Thumbnails',
    empty: 'Noch keine Ergebnisse. Lade ein Video hoch und starte die Generierung.',
    status: 'Status',
    pickFileFirst: 'Bitte zuerst ein Video auswählen.',
    backendError: 'Serverfehler'
  },
  en: {
    title: 'ClipCraft',
    subtitle: 'Upload a short video (max. 30s) to get transcript, title and thumbnail suggestions.',
    upload: 'Choose video',
    start: 'Generate',
    processing: 'Processing',
    transcript: 'Transcript',
    generatedTitle: 'Title suggestion',
    thumbs: 'Thumbnails',
    empty: 'No results yet. Upload a video and start generation.',
    status: 'Status',
    pickFileFirst: 'Please select a video first.',
    backendError: 'Server error'
  }
};

const statusColor: Record<JobData['status'], string> = {
  queued: '#f59e0b',
  processing: '#60a5fa',
  done: '#34d399',
  error: '#f87171'
};

export default function Home() {
  const [lang, setLang] = useState<'de' | 'en'>('de');
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(false);
  const [uiError, setUiError] = useState<string>('');

  const t = useMemo(() => copy[lang], [lang]);

  useEffect(() => {
    if (!job?.job_id || job.status === 'done' || job.status === 'error') return;

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.job_id}`);
        const text = await res.text();
        const parsed = text ? JSON.parse(text) : null;
        if (!res.ok) {
          setJob((prev) => (prev ? { ...prev, status: 'error', error: parsed?.detail || parsed?.error || text || t.backendError } : prev));
          return;
        }
        setJob(parsed);
      } catch (e) {
        setJob((prev) => (prev ? { ...prev, status: 'error', error: e instanceof Error ? e.message : t.backendError } : prev));
      }
    }, 2000);

    return () => clearInterval(id);
  }, [job, t.backendError]);

  async function submit() {
    setUiError('');
    if (!file) {
      setUiError(t.pickFileFirst);
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('video', file);

      const res = await fetch('/api/jobs', { method: 'POST', body: fd });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;

      if (!res.ok) {
        const msg = parsed?.detail || parsed?.error || text || t.backendError;
        setUiError(msg);
        setLoading(false);
        return;
      }

      setJob({ job_id: parsed.job_id, status: 'queued' });
    } catch (e) {
      setUiError(e instanceof Error ? e.message : t.backendError);
    }
    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <div style={{
        border: '1px solid #1f2937', borderRadius: 20, padding: 22,
        background: 'linear-gradient(180deg, #111827 0%, #0b1220 100%)', boxShadow: '0 20px 40px rgba(0,0,0,.35)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 38, lineHeight: 1.05 }}>{t.title}</h1>
            <p style={{ color: '#cbd5e1', marginTop: 10, marginBottom: 0 }}>{t.subtitle}</p>
          </div>
          <select value={lang} onChange={(e) => setLang(e.target.value as 'de' | 'en')} style={{
            background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: 10, padding: '8px 10px'
          }}>
            <option value='de'>Deutsch</option>
            <option value='en'>English</option>
          </select>
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type='file' accept='video/*' onChange={(e) => setFile(e.target.files?.[0] || null)} style={{
            color: '#e2e8f0', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 8
          }} />
          <button onClick={submit} disabled={!file || loading} style={{
            border: 0, borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
            background: loading ? '#475569' : '#2563eb', color: 'white', fontWeight: 600
          }}>{loading ? '...' : t.start}</button>
        </div>

        {uiError && <div style={{ marginTop: 14, background: '#7f1d1d', color: '#fee2e2', border: '1px solid #ef4444', borderRadius: 10, padding: 12 }}>{uiError}</div>}

        {job && (
          <div style={{ marginTop: 14, display: 'inline-flex', gap: 8, alignItems: 'center', border: '1px solid #334155', borderRadius: 999, padding: '6px 10px' }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: statusColor[job.status] }} />
            <span style={{ color: '#cbd5e1' }}>{t.status}: {job.status === 'processing' ? t.processing : job.status}</span>
          </div>
        )}
      </div>

      <section style={{ marginTop: 20, border: '1px solid #1f2937', borderRadius: 16, padding: 18, background: '#0b1220' }}>
        {!job && <p style={{ margin: 0, color: '#94a3b8' }}>{t.empty}</p>}

        {job?.status === 'done' && (
          <>
            <h3 style={{ marginBottom: 8 }}>{t.generatedTitle}</h3>
            <p style={{ marginTop: 0 }}>{job.title}</p>

            <h3 style={{ marginBottom: 8 }}>{t.transcript}</h3>
            <p style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{job.transcript}</p>

            <h3 style={{ marginBottom: 8 }}>{t.thumbs}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
              {Object.entries(job.thumbnails || {}).map(([k, url]) => (
                <div key={k} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 10 }}>
                  <strong style={{ color: '#e2e8f0' }}>{k}</strong>
                  <img src={`${process.env.NEXT_PUBLIC_BACKEND_URL}${url}`} alt={k} style={{ width: '100%', borderRadius: 8, marginTop: 8 }} />
                </div>
              ))}
            </div>
          </>
        )}

        {job?.status === 'error' && <div style={{ color: '#fca5a5', background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 10, padding: 12 }}>{job.error || t.backendError}</div>}
      </section>
    </main>
  );
}
