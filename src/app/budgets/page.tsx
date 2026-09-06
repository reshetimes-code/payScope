import { prisma } from '@/lib/db/prisma';
import { monthProgress, projectedMonthEnd } from '@/lib/forecast/mtd';
import { BudgetForm } from '@/components/budget-form';
import { HardStopToggle } from '@/components/hard-stop-toggle';
import { BulkBudgetForm } from '@/components/bulk-budget-form';
import { TableRow } from '@/components/table-row';

// See src/app/google/projects/page.tsx for why this must stay dynamic.
export const dynamic = 'force-dynamic';

// Spec §13 — one table for all budgets across all providers. Only Google is
// wired end-to-end today (Phase 1); OpenAI/Anthropic budgets will appear
// here once Phase 2 connectors write Budget rows the same way.
export default async function BudgetsPage() {
  // MANAGED_APP budgets track every resource mapped to a site combined —
  // e.g. Mishpatly spans its main Cloud Run project *and* a separate
  // Gemini/AI project, and a single-resource budget would silently miss
  // the AI slice. See lib/alerts/evaluate-budgets.ts.
  const budgets = await prisma.budget.findMany({
    where: { scopeType: { in: ['PROVIDER_RESOURCE', 'MANAGED_APP'] } },
    orderBy: { createdAt: 'desc' },
  });

  const resourceIds = budgets.filter((b) => b.scopeType === 'PROVIDER_RESOURCE').map((b) => b.scopeId);
  const resources = await prisma.providerResource.findMany({
    where: { id: { in: resourceIds } },
    include: { account: true, appMappings: { include: { managedApp: true } } },
  });
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  const managedAppIds = budgets.filter((b) => b.scopeType === 'MANAGED_APP').map((b) => b.scopeId);
  const managedApps = await prisma.managedApp.findMany({ where: { id: { in: managedAppIds } } });
  const managedAppById = new Map(managedApps.map((a) => [a.id, a]));

  const activeStops = await prisma.budgetEvent.findMany({
    where: { budgetId: { in: budgets.map((b) => b.id) }, eventType: 'HARD_STOP_SUCCEEDED', resumedAt: null },
    select: { budgetId: true },
  });
  const suspendedBudgetIds = new Set(activeStops.map((s) => s.budgetId));

  const { monthStart, elapsedDays, totalDays } = monthProgress();
  const spendByResource = new Map(
    (
      await prisma.costRecord.groupBy({
        by: ['providerResourceId'],
        where: { usageDate: { gte: monthStart } },
        _sum: { netCost: true },
      })
    ).map((s) => [s.providerResourceId, Number(s._sum.netCost ?? 0)]),
  );
  const spendByManagedApp = new Map(
    (
      await prisma.costRecord.groupBy({
        by: ['managedAppId'],
        where: { usageDate: { gte: monthStart }, managedAppId: { not: null } },
        _sum: { netCost: true },
      })
    ).map((s) => [s.managedAppId, Number(s._sum.netCost ?? 0)]),
  );

  const budgetedResourceIds = new Set(resourceIds);
  const unbudgetedResources = (
    await prisma.providerResource.findMany({
      where: { resourceType: 'gcp_project', id: { notIn: [...budgetedResourceIds] } },
      include: { account: true },
    })
  ).map((r) => ({
    providerResourceId: r.id,
    displayName: r.displayName,
    externalResourceId: r.externalResourceId,
    billingAccountId: r.account.externalAccountId,
  }));

  return (
    <main className="page-shell">
      <h1 className="page-title">מרכז תקציבים</h1>
      <p className="mt-1 text-sm text-stone-400">
        כל התקציבים בכל הספקים במקום אחד. תקציב = Provider budget/alert (§21)
        — לא חסימה מובטחת, אלא אם Hard Stop מופעל במפורש לכל תקציב בנפרד.
      </p>

      <div className="mt-4 card-table">
        <table className="w-full text-sm">
          <thead className="table-head hidden md:table-header-group">
            <tr>
              <th className="p-3">ספק</th>
              <th className="p-3">פרויקט / אתר</th>
              <th className="p-3">תקציב חודשי</th>
              <th className="p-3">הוצאה החודש</th>
              <th className="p-3">ניצול</th>
              <th className="p-3">תחזית</th>
              <th className="p-3">אכיפה</th>
              <th className="p-3">סטטוס הגנה</th>
              <th className="p-3">Hard Stop</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((budget) => {
              const isAppScoped = budget.scopeType === 'MANAGED_APP';
              const resource = isAppScoped ? undefined : resourceById.get(budget.scopeId);
              const managedApp = isAppScoped ? managedAppById.get(budget.scopeId) : undefined;
              const spend = isAppScoped
                ? (spendByManagedApp.get(budget.scopeId) ?? 0)
                : (spendByResource.get(budget.scopeId) ?? 0);
              const amount = Number(budget.amount);
              const percent = amount > 0 ? (spend / amount) * 100 : 0;
              const forecast = projectedMonthEnd(spend, elapsedDays, totalDays);
              const fullMapping = resource?.appMappings.find((m) => m.allocationMode === 'FULL');
              const appName = isAppScoped
                ? managedApp?.name
                : (fullMapping?.managedApp?.name ?? resource?.appMappings[0]?.managedApp?.name);
              const hasTarget = Boolean(
                fullMapping?.managedApp?.hardStopCloudRunRegion &&
                  fullMapping?.managedApp?.hardStopCloudRunServiceName,
              );

              return (
                <TableRow
                  key={budget.id}
                  cells={[
                    { header: 'ספק', content: 'Google Cloud' },
                    {
                      header: 'פרויקט / אתר',
                      primary: true,
                      content: (
                        <span>
                          {appName ?? resource?.displayName ?? '—'}
                          <div className="text-xs text-stone-500">
                            {isAppScoped ? 'כל האתר (כל המשאבים)' : resource?.externalResourceId}
                          </div>
                        </span>
                      ),
                    },
                    { header: 'תקציב חודשי', content: `${amount.toFixed(2)} ${budget.currency}` },
                    { header: 'הוצאה החודש', content: `${spend.toFixed(2)} ${budget.currency}` },
                    {
                      header: 'ניצול',
                      primary: true,
                      content: (
                        <span
                          className={
                            percent >= 100
                              ? 'text-red-400'
                              : percent >= 90
                                ? 'text-orange-400'
                                : percent >= 75
                                  ? 'text-yellow-400'
                                  : 'text-green-400'
                          }
                        >
                          {percent.toFixed(0)}%
                        </span>
                      ),
                    },
                    { header: 'תחזית', content: `${forecast.toFixed(2)} ${budget.currency}` },
                    {
                      header: 'אכיפה',
                      content: (
                        <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs text-blue-400 ring-1 ring-inset ring-blue-500/30">
                          Provider alert
                        </span>
                      ),
                    },
                    {
                      header: 'סטטוס הגנה',
                      className: 'text-xs',
                      // Spec §34.10 indicators — reflects the real, current
                      // hardStopEnabled state; never shown as protected unless
                      // it actually is.
                      content: suspendedBudgetIds.has(budget.id)
                        ? '🔴 עבר תקציב — השירות הושהה'
                        : budget.hardStopEnabled
                          ? '🟢 מוגן — עצירה אוטומטית פעילה'
                          : '🟡 התראות בלבד',
                    },
                    {
                      header: 'Hard Stop',
                      content: isAppScoped ? (
                        <span
                          className="text-xs text-stone-600"
                          title="תקציב ברמת אתר שלם — Hard Stop נתמך רק לתקציב על משאב יחיד"
                        >
                          לא זמין ברמת אתר
                        </span>
                      ) : (
                        resource && (
                          <HardStopToggle
                            budgetId={budget.id}
                            projectExternalId={resource.externalResourceId}
                            enabled={budget.hardStopEnabled}
                            hasTarget={hasTarget}
                            suspended={suspendedBudgetIds.has(budget.id)}
                          />
                        )
                      ),
                    },
                  ]}
                />
              );
            })}
            {budgets.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-sm text-stone-500">
                  אין עדיין תקציבים מוגדרים.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <BulkBudgetForm />
      </div>

      <section className="mt-6 card">
        <h2 className="font-medium">הגדר תקציב לאתר בודד</h2>
        <div className="mt-3">
          <BudgetForm unbudgetedResources={unbudgetedResources} />
        </div>
      </section>
    </main>
  );
}
