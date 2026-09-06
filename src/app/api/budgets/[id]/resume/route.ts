import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { resumeGoogleHardStop } from '@/lib/alerts/resume-hard-stop';
import { writeAuditLog } from '@/lib/audit/log';

// Spec §34.7 — manual resume after a Hard Stop. Reverses exactly the
// recorded stop action (lib/alerts/resume-hard-stop.ts); never a blind
// re-enable.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const correlationId = randomUUID();
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });

  const result = await resumeGoogleHardStop(id, user?.id ?? null);

  await writeAuditLog({
    actorUserId: user?.id,
    actorLabel: session.user.email,
    action: 'budget.hardStop.resume',
    resource: id,
    newValue: result,
    result: result.ok ? 'SUCCESS' : 'FAILURE',
    errorSummary: result.ok ? undefined : result.message,
    requestCorrelationId: correlationId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json(result);
}
