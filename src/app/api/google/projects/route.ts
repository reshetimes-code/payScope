import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

// Spec §5.5 / §11 "Google projects table" — every discovered project, even
// unmapped/unbilled ones, so nothing charging money goes silently missing.
export async function GET() {
  const connection = await prisma.providerConnection.findFirst({
    where: { provider: 'GOOGLE_CLOUD' },
  });

  if (!connection) {
    return NextResponse.json({ projects: [] });
  }

  const resources = await prisma.providerResource.findMany({
    where: { account: { providerConnectionId: connection.id } },
    include: {
      account: true,
      appMappings: { include: { managedApp: true } },
    },
  });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const monthCosts = await prisma.costRecord.groupBy({
    by: ['providerResourceId'],
    where: { usageDate: { gte: monthStart } },
    _sum: { netCost: true, grossCost: true, credits: true },
  });
  const costByResource = new Map(monthCosts.map((c) => [c.providerResourceId, c._sum]));

  const budgets = await prisma.budget.findMany({
    where: { provider: 'GOOGLE_CLOUD', scopeType: 'PROVIDER_RESOURCE' },
  });
  const budgetByResource = new Map(budgets.map((b) => [b.scopeId, b]));

  return NextResponse.json({
    lastSyncAt: connection.lastSyncAt,
    projects: resources.map((r) => {
      const sums = costByResource.get(r.id);
      const budget = budgetByResource.get(r.id);
      const netCost = sums?.netCost ? Number(sums.netCost) : 0;

      return {
        projectId: r.externalResourceId,
        displayName: r.displayName,
        status: r.status,
        billingAccountId: r.account.externalAccountId,
        mappedAppName: r.appMappings[0]?.managedApp?.name ?? null,
        monthToDateGrossCost: sums?.grossCost ? Number(sums.grossCost) : 0,
        monthToDateCredits: sums?.credits ? Number(sums.credits) : 0,
        monthToDateNetCost: netCost,
        budgetAmount: budget ? Number(budget.amount) : null,
        budgetPercentConsumed: budget && Number(budget.amount) > 0 ? (netCost / Number(budget.amount)) * 100 : null,
        lastSeenAt: r.lastSeenAt,
      };
    }),
  });
}
