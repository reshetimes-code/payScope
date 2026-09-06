// Shared "site cost table" computation — used by both the live dashboard
// (current month) and /history (any past completed month), so both render
// the exact same columns from the exact same logic, just a different date
// range. See src/app/dashboard/page.tsx for the original inline version
// this was extracted from.

import { prisma } from '@/lib/db/prisma';

export interface SiteCostRow {
  id: string;
  name: string;
  domain: string | null;
  billingAccounts: { externalAccountId: string; displayName: string }[];
  resourceCount: number;
  spend: number;
  spendCurrency: string;
  budgetAmount: number | null;
  budgetCurrency: string | null;
  utilizationPercent: number | null;
}

export async function getSiteCostRows(range: {
  start: Date;
  end: Date;
}): Promise<{ rows: SiteCostRow[]; billingAccountLabels: Map<string, string> }> {
  const sites = await prisma.managedApp.findMany({
    include: {
      resourceMappings: { include: { providerResource: { include: { account: true } } } },
      budgets: true,
    },
    orderBy: { name: 'asc' },
  });

  const siteSpend = await prisma.costRecord.groupBy({
    by: ['managedAppId', 'currency'],
    where: { usageDate: { gte: range.start, lt: range.end }, managedAppId: { not: null } },
    _sum: { netCost: true },
  });
  const spendBySite = new Map(
    siteSpend.map((s) => [s.managedAppId, { amount: Number(s._sum.netCost ?? 0), currency: s.currency }]),
  );

  // Same stable "BILLING N" scheme as the dashboard — sorted alphabetically
  // by the real id, not discovery order.
  const billingAccountLabels = new Map(
    [...new Set(sites.flatMap((s) => s.resourceMappings.map((m) => m.providerResource.account.externalAccountId)))]
      .sort()
      .map((id, i) => [id, `BILLING ${i + 1}`]),
  );

  const rows: SiteCostRow[] = sites.map((site) => {
    const spendEntry = spendBySite.get(site.id);
    const spend = spendEntry?.amount ?? 0;
    const spendCurrency = spendEntry?.currency ?? '';
    // Budgets have no historical versioning in this app — a past month's
    // "utilization" here is spend-then vs. *today's* budget config, not
    // whatever the budget actually was back then. Callers should say so.
    const budget = site.budgets[0];
    const budgetAmount = budget ? Number(budget.amount) : null;
    const percent = budgetAmount && budgetAmount > 0 ? (spend / budgetAmount) * 100 : null;
    const billingAccounts = [
      ...new Map(
        site.resourceMappings.map((m) => [m.providerResource.account.externalAccountId, m.providerResource.account]),
      ).values(),
    ];

    return {
      id: site.id,
      name: site.name,
      domain: site.domain,
      billingAccounts: billingAccounts.map((a) => ({
        externalAccountId: a.externalAccountId,
        displayName: a.displayName,
      })),
      resourceCount: site.resourceMappings.length,
      spend,
      spendCurrency,
      budgetAmount,
      budgetCurrency: budget?.currency ?? null,
      utilizationPercent: percent,
    };
  });

  return { rows, billingAccountLabels };
}
