import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { testApiKey } from '@/lib/providers/render/client';
import { runRenderDiscoverySync } from '@/lib/providers/render/sync';
import { writeAuditLog } from '@/lib/audit/log';

// "Connect" step for Render — unlike Google there's no per-user OAuth
// consent to redirect through, RENDER_API_KEY is a static account-level key,
// so testing it and running discovery is one action.
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const correlationId = randomUUID();

  const test = await testApiKey();
  if (!test.ok) {
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'render.discover',
      provider: 'RENDER',
      result: 'FAILURE',
      errorSummary: test.message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: test.message }, { status: 400 });
  }

  try {
    const summary = await runRenderDiscoverySync();
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'render.discover',
      provider: 'RENDER',
      newValue: summary,
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'render.discover',
      provider: 'RENDER',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
