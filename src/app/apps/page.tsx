import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { NewAppForm } from '@/components/new-app-form';
import { QuickAddSite } from '@/components/quick-add-site';

// See src/app/google/projects/page.tsx for why this must stay dynamic.
export const dynamic = 'force-dynamic';

export default async function AppsPage() {
  const apps = await prisma.managedApp.findMany({
    include: { resourceMappings: true },
    orderBy: { name: 'asc' },
  });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const costs = await prisma.costRecord.groupBy({
    by: ['managedAppId', 'currency'],
    where: { usageDate: { gte: monthStart }, managedAppId: { not: null } },
    _sum: { netCost: true },
  });
  const costByApp = new Map(costs.map((c) => [c.managedAppId, { amount: c._sum.netCost, currency: c.currency }]));

  // All discoverable resource types across every connected provider — not
  // just Google's gcp_project — so Render services/databases show up here
  // too, both in the "still unmapped" warning and the manual-add dropdown.
  const unmappedResources = await prisma.providerResource.findMany({
    where: { resourceType: { in: ['gcp_project', 'render_service', 'render_postgres'] }, appMappings: { none: {} } },
    select: { id: true, displayName: true, externalResourceId: true, resourceType: true },
    orderBy: { displayName: 'asc' },
  });
  const unmappedProjectCount = unmappedResources.length;

  return (
    <main className="page-shell">
      <h1 className="page-title">אתרים / מערכות</h1>
      <p className="mt-1 text-sm text-stone-400">
        מיפוי בין פרויקטי ענן לבין האתרים העסקיים שלך (ראו §2 בספק — פרויקט GCP
        ≠ אתר בהכרח).
      </p>

      {unmappedProjectCount > 0 && (
        <p className="mt-3 rounded-lg bg-orange-500/10 p-3 text-sm text-orange-400 ring-1 ring-inset ring-orange-500/20">
          {unmappedProjectCount} משאבים (Google Cloud / Render) עדיין לא משויכים לאף אתר — אפשר לשייך
          אותם למטה ב"הוספה ידנית".
        </p>
      )}

      <div className="mt-4">
        <QuickAddSite />
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-stone-400 hover:text-stone-200">
          הוספה ידנית / בחירה בין כמה אפשרויות
        </summary>
        <div className="mt-2">
          <NewAppForm unmappedResources={unmappedResources} />
        </div>
      </details>

      <div className="mt-4 card-table">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="p-3">אתר</th>
              <th className="p-3">משאבים ממופים</th>
              <th className="p-3">הוצאה החודש (נטו)</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => (
              <tr key={app.id} className="border-t border-stone-800">
                <td className="p-3">
                  <Link href={`/apps/${app.id}`} className="link-strong">
                    {app.name}
                  </Link>
                  {app.domain && <div className="text-xs text-stone-500">{app.domain}</div>}
                </td>
                <td className="p-3">{app.resourceMappings.length}</td>
                <td className="p-3">
                  {(() => {
                    const cost = costByApp.get(app.id);
                    return cost?.amount ? `${Number(cost.amount).toFixed(2)} ${cost.currency}` : '0.00';
                  })()}
                </td>
              </tr>
            ))}
            {apps.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-sm text-stone-500">
                  אין עדיין אתרים — צור אתר ומפה אליו פרויקטים.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
