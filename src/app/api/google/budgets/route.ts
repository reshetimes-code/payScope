import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { upsertBudget } from '@/lib/providers/google/budgets';
import { getGoogleAuthClientFromSession } from '@/lib/providers/google/user-auth';
import { writeAuditLog } from '@/lib/audit/log';

export async function GET() {
  const budgets = await prisma.budget.findMany({
    where: { provider: 'GOOGLE_CLOUD' },
    include: { managedApp: true, thresholds: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ budgets });
}

// Spec §5.6/§17 step 6 — set a monthly budget on a Google Cloud project.
// This is Mode B (Provider budget/alert, spec §5.7) — creating this budget
// never itself stops usage. hardStopEnabled defaults to false and is a
// separate, explicit opt-in (spec §34.11), not implied by having a budget.
const createSchema = z.object({
  billingAccountId: z.string().min(1),
  projectExternalId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(1),
  thresholdsPercent: z.array(z.number().min(1).max(200)).min(1).default([50, 75, 90, 100]),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { billingAccountId, projectExternalId, amount, currency, thresholdsPercent } = parsed.data;
  const correlationId = randomUUID();

  try {
    const resource = await prisma.providerResource.findFirst({
      where: {
        externalResourceId: projectExternalId,
        account: { externalAccountId: billingAccountId },
      },
    });
    if (!resource) {
      return NextResponse.json(
        { error: 'הפרויקט לא נמצא — הרץ discovery תחילה.' },
        { status: 404 },
      );
    }

    const metadata = resource.metadataJson as { projectNumber?: string } | null;
    const projectNumber = metadata?.projectNumber;
    if (!projectNumber) {
      return NextResponse.json(
        { error: 'חסר מספר פרויקט (project number) — הרץ discovery מחדש.' },
        { status: 400 },
      );
    }

    const existing = await prisma.budget.findFirst({
      where: { scopeType: 'PROVIDER_RESOURCE', scopeId: resource.id, provider: 'GOOGLE_CLOUD' },
    });

    const authClient = getGoogleAuthClientFromSession(session) ?? undefined;
    const providerResult = await upsertBudget(
      {
        billingAccountId,
        existingBudgetName: existing?.providerBudgetId ?? undefined,
        displayName: `PAY SCOPE — ${projectExternalId}`,
        projectNumber,
        amount,
        currencyCode: currency,
        thresholdsPercent,
      },
      authClient,
    );

    const budget = existing
      ? await prisma.budget.update({
          where: { id: existing.id },
          data: {
            amount,
            currency,
            providerBudgetId: providerResult.name,
            enforcementType: 'PROVIDER_ALERT',
          },
        })
      : await prisma.budget.create({
          data: {
            scopeType: 'PROVIDER_RESOURCE',
            scopeId: resource.id,
            provider: 'GOOGLE_CLOUD',
            amount,
            currency,
            enforcementType: 'PROVIDER_ALERT',
            providerBudgetId: providerResult.name,
          },
        });

    // Plain find-then-create rather than an upsert on a nullable compound
    // key (triggerCycleKey is null until a threshold actually fires, and
    // Postgres/Prisma unique-constraint semantics for NULL make that upsert
    // key unreliable) — see prisma/schema.prisma BudgetThreshold.
    for (const percent of thresholdsPercent) {
      const alreadyExists = await prisma.budgetThreshold.findFirst({
        where: { budgetId: budget.id, percent },
      });
      if (!alreadyExists) {
        await prisma.budgetThreshold.create({ data: { budgetId: budget.id, percent } });
      }
    }

    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'google.budget.upsert',
      provider: 'GOOGLE_CLOUD',
      resource: projectExternalId,
      oldValue: existing,
      newValue: budget,
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });

    return NextResponse.json({ budget, providerResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set budget';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'google.budget.upsert',
      provider: 'GOOGLE_CLOUD',
      resource: projectExternalId,
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
