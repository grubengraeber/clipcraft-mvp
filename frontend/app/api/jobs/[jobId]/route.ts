import { NextRequest, NextResponse } from 'next/server';

const backend = process.env.BACKEND_URL || 'http://localhost:8000';
const apiKey = process.env.BACKEND_API_KEY || '';

export async function GET(_: NextRequest, { params }: { params: { jobId: string } }) {
  const res = await fetch(`${backend}/jobs/${params.jobId}`, {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store'
  });

  const text = await res.text();
  return new NextResponse(text, { status: res.status });
}
