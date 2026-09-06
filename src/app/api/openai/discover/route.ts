import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { testAdminKey } from '@/lib/providers/openai/client';
import { runOpenAiDiscoverySync } from '@/lib/providers/openai/sync';
import { writeAuditLog } from '@/lib/audit/log';

// "Connect" step for OpenAI — unlike Google there's no per-user OAuth
// consent to redirect through, OPENAI_ADMIN_KEY is a static org-level key
// (spec §9), so testing it and running discovery is one action.
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const correlationId = randomUUID();

  const test = await testAdminKey();
  if (!test.ok) {
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'openai.discover',
      provider: 'OPENAI',
      result: 'FAILURE',
      errorSummary: test.message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: test.message }, { status: 400 });
  }

  try {
    const summary = await runOpenAiDiscoverySync();
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'openai.discover',
      provider: 'OPENAI',
      newValue: summary,
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'openai.discover',
      provider: 'OPENAI',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
