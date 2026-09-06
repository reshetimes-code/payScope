import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';

// Spec §34.11 — "No Hard Stop may be enabled until the application has
// positively verified the provider resource/account/project that will be
// affected... show a one-time confirmation containing the exact site,
// provider, project/account identifier, monthly budget, and what technical
// action will occur." Enforced here by requiring the caller to echo back
// the exact GCP project id — not just click a button — before flipping
// hardStopEnabled to true. Disabling never requires confirmation.
const bodySchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(true), confirmProjectId: z.string().min(1) }),
  z.object({ enabled: z.literal(false) }),
]);

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
    const budget = await prisma.budget.findUnique({ where: { id } });
    if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });

    if (parsed.data.enabled) {
      if (budget.scopeType !== 'PROVIDER_RESOURCE') {
        return NextResponse.json(
          { error: 'Hard Stop is only supported for project-scoped budgets today.' },
          { status: 400 },
        );
      }

      const resource = await prisma.providerResource.findUnique({ where: { id: budget.scopeId } });
      if (!resource) {
        return NextResponse.json({ error: 'Underlying project not found — cannot verify scope.' }, { status: 404 });
      }

      if (parsed.data.confirmProjectId !== resource.externalResourceId) {
        return NextResponse.json(
          {
            error: `אימות נכשל — הקלד בדיוק את מזהה הפרויקט "${resource.externalResourceId}" כדי לאשר.`,
          },
          { status: 400 },
        );
      }

      const fullMappings = await prisma.appResourceMapping.findMany({
        where: { providerResourceId: resource.id, allocationMode: 'FULL' },
      });
      if (fullMappings.length !== 1) {
        return NextResponse.json(
          {
            error:
              'לא ניתן להפעיל Hard Stop — הפרויקט חייב להיות ממופה במלואו (FULL) לאתר אחד בדיוק, ' +
              `כרגע יש ${fullMappings.length}.`,
          },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.budget.update({
      where: { id },
      data: { hardStopEnabled: parsed.data.enabled },
    });

    await writeAuditLog({
      actorLabel: session.user.email,
      action: parsed.data.enabled ? 'budget.hardStop.enable' : 'budget.hardStop.disable',
      provider: budget.provider,
      resource: budget.scopeId,
      oldValue: { hardStopEnabled: budget.hardStopEnabled },
      newValue: { hardStopEnabled: updated.hardStopEnabled },
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });

    return NextResponse.json({ budget: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update Hard Stop setting';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'budget.hardStop.update',
      resource: id,
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
