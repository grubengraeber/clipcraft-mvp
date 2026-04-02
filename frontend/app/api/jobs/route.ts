import { NextRequest, NextResponse } from 'next/server';

const backend = process.env.BACKEND_URL || 'http://localhost:8000';
const apiKey = process.env.BACKEND_API_KEY || '';

async function proxyWithRetry(body: FormData) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    return await fetch(`${backend}/jobs`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body,
      signal: controller.signal
    });
  } catch {
    await new Promise((r) => setTimeout(r, 900));
    return await fetch(`${backend}/jobs`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.formData();
    const res = await proxyWithRetry(body);
    const text = await res.text();

    return new NextResponse(text || JSON.stringify({ error: 'Empty backend response' }), {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json' }
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Backend currently unreachable. Please retry in a few seconds.' },
      { status: 503 }
    );
  }
}
