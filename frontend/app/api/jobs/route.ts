import { NextRequest, NextResponse } from 'next/server';

const backend = process.env.BACKEND_URL || 'http://localhost:8000';
const apiKey = process.env.BACKEND_API_KEY || '';

export async function POST(req: NextRequest) {
  const body = await req.formData();

  const res = await fetch(`${backend}/jobs`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body
  });

  const text = await res.text();
  return new NextResponse(text, { status: res.status });
}
