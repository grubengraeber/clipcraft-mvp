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
    title: 'Auto-Thumbnail MVP',
    subtitle: 'Video hochladen (max. 30s), Transkript + Titel + Thumbnails erhalten.',
    upload: 'Video auswählen',
    start: 'Verarbeiten',
    processing: 'Verarbeitung läuft ...',
    transcript: 'Transkript',
    generatedTitle: 'Generierter Titel',
    thumbs: 'Thumbnails'
  },
  en: {
    title: 'Auto Thumbnail MVP',
    subtitle: 'Upload a video (max 30s) and get transcript + title + thumbnails.',
    upload: 'Choose video',
    start: 'Process',
    processing: 'Processing ...',
    transcript: 'Transcript',
    generatedTitle: 'Generated title',
    thumbs: 'Thumbnails'
  }
};

export default function Home() {
  const [lang, setLang] = useState<'de' | 'en'>('de');
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(false);

  const t = useMemo(() => copy[lang], [lang]);

  useEffect(() => {
    if (!job?.job_id) return;
    if (job.status === 'done' || job.status === 'error') return;

    const id = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.job_id}`);
      if (!res.ok) return;
      const next = await res.json();
      setJob(next);
    }, 2000);

    return () => clearInterval(id);
  }, [job]);

  async function submit() {
    if (!file) return;
    setLoading(true);
    const fd = new FormData();
    fd.append('video', file);

    const res = await fetch('/api/jobs', { method: 'POST', body: fd });
    if (!res.ok) {
      const msg = await res.text();
      alert(msg);
      setLoading(false);
      return;
    }

    const created = await res.json();
    setJob({ job_id: created.job_id, status: 'queued' });
    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1>{t.title}</h1>
        <select value={lang} onChange={(e) => setLang(e.target.value as 'de' | 'en')}>
          <option value='de'>Deutsch</option>
          <option value='en'>English</option>
        </select>
      </div>

      <p>{t.subtitle}</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input type='file' accept='video/*' onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button onClick={submit} disabled={!file || loading}>{loading ? '...' : t.start}</button>
      </div>

      {job && <p style={{ marginTop: 12 }}>{t.processing} [{job.status}]</p>}

      {job?.status === 'done' && (
        <section style={{ marginTop: 24 }}>
          <h3>{t.generatedTitle}</h3>
          <p>{job.title}</p>

          <h3>{t.transcript}</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{job.transcript}</p>

          <h3>{t.thumbs}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {Object.entries(job.thumbnails || {}).map(([k, url]) => (
              <div key={k}>
                <strong>{k}</strong>
                <img src={`${process.env.NEXT_PUBLIC_BACKEND_URL}${url}`} alt={k} style={{ width: '100%', borderRadius: 8 }} />
              </div>
            ))}
          </div>
        </section>
      )}

      {job?.status === 'error' && <p style={{ color: '#ff6b6b' }}>{job.error}</p>}
    </main>
  );
}
