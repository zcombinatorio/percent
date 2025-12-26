import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const API_URL = process.env.API_URL || 'http://localhost:3001';

  try {
    const body = await request.json();

    const response = await fetch(`${API_URL}/api/proposal-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Proposal request submission error:', error);
    return NextResponse.json(
      { error: 'Failed to submit proposal request' },
      { status: 500 }
    );
  }
}
