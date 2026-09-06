import { NextResponse } from 'next/server';
import { verifyInternalRequest } from '@/lib/auth/verify-internal';
import { runRenderDiscoverySync } from '@/lib/providers/render/sync';

// Hit by Cloud Scheduler, same shape and same auth gate as
// /api/internal/sync/google and /api/internal/sync/openai — see
// verify-internal.ts. Discovery only (no cost sync — see
// lib/providers/render/adapter.ts capabilities comment).
export async function POST(req: Request) {
  const verification = await verifyInternalRequest(req.headers.get('authorization'));
  if (!verification.ok) {
    console.error('Rejected /api/internal/sync/render request:', verification.reason);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Skipped entirely (not just a no-op error) when the key isn't configured
  // yet — a connector the owner hasn't turned on yet must not show up as a
  // "failed" job in /audit every 3 hours.
  if (!process.env.RENDER_API_KEY) {
    return NextResponse.json({ skipped: 'RENDER_API_KEY not configured' });
  }

  try {
    const discovery = await runRenderDiscoverySync();
    return NextResponse.json({ discovery });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Render sync failed';
    console.error('Render scheduled sync failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
