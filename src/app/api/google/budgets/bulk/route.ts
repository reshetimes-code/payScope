import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { upsertBudget } from '@/lib/providers/google/budgets';
import { getGoogleAuthClientFromSession } from '@/lib/providers/google/user-auth';
import { writeAuditLog } from '@/lib/audit/log';

// Spec §13 "Bulk action: set default alert thresholds ... across selected
// resources" — applied here to the amount itself too, not just thresholds,
// since setting 9 identical budgets one-by-one has no value over doing it
// once. Only touches Google-mapped sites that don't already have a budget;
// never overwrites an existing one.
const bodySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1),
  thresholdsPercent: z.array(z.number().min(1).max(200)).min(1).default([50, 75, 90, 100]),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { amount, currency, thresholdsPercent } = parsed.data;
  const authClient = getGoogleAuthClientFromSession(session) ?? undefined;

  const resources = await prisma.providerResource.findMany({
    where: {
      resourceType: 'gcp_project',
      appMappings: { some: { allocationMode: 'FULL' } },
    },
    include: { account: true, appMappings: true },
  });

  const results: { site: string; ok: boolean; message: string }[] = [];

  for (const resource of resources) {
    const correlationId = randomUUID();

    const existing = await prisma.budget.findFirst({
      where: { scopeType: 'PROVIDER_RESOURCE', scopeId: resource.id, provider: 'GOOGLE_CLOUD' },
    });
    if (existing) {
      results.push({ site: resource.displayName, ok: true, message: 'כבר יש תקציב — דילגתי' });
      continue;
    }

    const metadata = resource.metadataJson as { projectNumber?: string } | null;
    const projectNumber = metadata?.projectNumber;
    if (!projectNumber) {
      results.push({ site: resource.displayName, ok: false, message: 'חסר project number' });
      continue;
    }
    if (resource.account.externalAccountId === 'unknown') {
      results.push({ site: resource.displayName, ok: false, message: 'אין billing account מזוהה' });
      continue;
    }

    try {
      const providerResult = await upsertBudget(
        {
          billingAccountId: resource.account.externalAccountId,
          displayName: `PAY SCOPE — ${resource.externalResourceId}`,
          projectNumber,
          amount,
          currencyCode: currency,
          thresholdsPercent,
        },
        authClient,
      );

      const budget = await prisma.budget.create({
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

      for (const percent of thresholdsPercent) {
        await prisma.budgetThreshold.create({ data: { budgetId: budget.id, percent } });
      }

      await writeAuditLog({
        actorLabel: session.user.email,
        action: 'google.budget.bulkCreate',
        provider: 'GOOGLE_CLOUD',
        resource: resource.externalResourceId,
        newValue: budget,
        result: 'SUCCESS',
        requestCorrelationId: correlationId,
      });

      results.push({ site: resource.displayName, ok: true, message: `${amount} ${currency}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'נכשל';
      await writeAuditLog({
        actorLabel: session.user.email,
        action: 'google.budget.bulkCreate',
        provider: 'GOOGLE_CLOUD',
        resource: resource.externalResourceId,
        result: 'FAILURE',
        errorSummary: message,
        requestCorrelationId: correlationId,
      });
      results.push({ site: resource.displayName, ok: false, message });
    }
  }

  return NextResponse.json({ results });
}
