import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';

// Configures WHICH Cloud Run service Hard Stop scales to zero for this app
// (spec §34 — see src/lib/alerts/execute-hard-stops.ts for why this can't be
// derived automatically from cost/billing data). Setting this does NOT by
// itself enable Hard Stop — that is a separate, explicitly-confirmed step
// per budget (POST /api/budgets/:id/hard-stop, spec §34.11).
const bodySchema = z.object({
  region: z.string().min(1),
  serviceName: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const correlationId = randomUUID();

  try {
    const before = await prisma.managedApp.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: 'App not found' }, { status: 404 });

    const app = await prisma.managedApp.update({
      where: { id },
      data: {
        hardStopCloudRunRegion: parsed.data.region,
        hardStopCloudRunServiceName: parsed.data.serviceName,
      },
    });

    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.hardStopTarget.set',
      resource: id,
      oldValue: {
        region: before.hardStopCloudRunRegion,
        serviceName: before.hardStopCloudRunServiceName,
      },
      newValue: { region: app.hardStopCloudRunRegion, serviceName: app.hardStopCloudRunServiceName },
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });

    return NextResponse.json({ app });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set Hard Stop target';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.hardStopTarget.set',
      resource: id,
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
