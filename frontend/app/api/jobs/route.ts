import { NextRequest, NextResponse } from 'next/server';

const backend = process.env.BACKEND_URL || 'http://localhost:8000';
const apiKey = process.env.BACKEND_API_KEY || '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.formData();

    const res = await fetch(`${backend}/jobs`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body
    });

    const text = await res.text();
    return new NextResponse(text || JSON.stringify({ error: 'Empty backend response' }), {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json' }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload request failed' }, { status: 500 });
  }
}
