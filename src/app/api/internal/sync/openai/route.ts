import { NextResponse } from 'next/server';
import { verifyInternalRequest } from '@/lib/auth/verify-internal';
import { runOpenAiDiscoverySync, runOpenAiCostSync } from '@/lib/providers/openai/sync';

// Hit by Cloud Scheduler (spec §16), same shape and same auth gate as
// /api/internal/sync/google — see verify-internal.ts for why that check is
// the only thing standing between the internet and this endpoint.
export async function POST(req: Request) {
  const verification = await verifyInternalRequest(req.headers.get('authorization'));
  if (!verification.ok) {
    console.error('Rejected /api/internal/sync/openai request:', verification.reason);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Skipped entirely (not just a no-op error) when the key isn't
  // configured yet — a Phase 2 connector the owner hasn't turned on yet
  // must not show up as a "failed" job in /audit every 3 hours.
  if (!process.env.OPENAI_ADMIN_KEY) {
    return NextResponse.json({ skipped: 'OPENAI_ADMIN_KEY not configured' });
  }

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 3);

  try {
    const discovery = await runOpenAiDiscoverySync();
    const costs = await runOpenAiCostSync(from, now);
    return NextResponse.json({ discovery, costs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenAI sync failed';
    console.error('OpenAI scheduled sync failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
