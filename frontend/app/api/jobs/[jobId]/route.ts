import { NextRequest, NextResponse } from 'next/server';

const backend = process.env.BACKEND_URL || 'http://localhost:8000';
const apiKey = process.env.BACKEND_API_KEY || '';

export async function GET(_: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const res = await fetch(`${backend}/jobs/${params.jobId}`, {
      headers: { 'x-api-key': apiKey },
      cache: 'no-store'
    });

    const text = await res.text();
    return new NextResponse(text || JSON.stringify({ error: 'Empty backend response' }), {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json' }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Status request failed' }, { status: 500 });
  }
}
