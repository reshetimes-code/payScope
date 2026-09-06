import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { runGoogleDiscoverySync } from '@/lib/providers/google/sync';
import { getGoogleAuthClientFromSession } from '@/lib/providers/google/user-auth';
import { writeAuditLog } from '@/lib/audit/log';

// Setup wizard step 3 (spec §17) and manual "re-scan now" from /providers/google.
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const correlationId = randomUUID();
  const authClient = getGoogleAuthClientFromSession(session) ?? undefined;

  try {
    const summary = await runGoogleDiscoverySync(authClient);
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'google.discover',
      provider: 'GOOGLE_CLOUD',
      newValue: summary,
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'google.discover',
      provider: 'GOOGLE_CLOUD',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
