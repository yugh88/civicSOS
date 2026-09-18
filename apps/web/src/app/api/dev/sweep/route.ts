import { NextResponse } from 'next/server';
import { LOCAL_API_ENABLED, runLocalSweep } from '@/server/local-runtime';

/**
 * Development-only trigger for the reminder sweep.
 *
 * In production this runs on an EventBridge daily schedule. Locally it is a
 * button so the reminder and escalation behaviour can be shown in a demo without
 * waiting for tomorrow.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  if (!LOCAL_API_ENABLED) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const result = await runLocalSweep();
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
