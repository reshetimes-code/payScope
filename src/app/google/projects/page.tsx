import { prisma } from '@/lib/db/prisma';
import { TableRow } from '@/components/table-row';

// Reads live cost/budget data on every request — must never be statically
// prerendered/cached, or the page would silently freeze on whatever numbers
// happened to be in the DB at build time (directly contradicts spec §16's
// "never imply a number is real-time when it's actually stale" — this would
// be worse: stale AND unlabeled). Every other DB-backed page added later
// needs the same directive.
export const dynamic = 'force-dynamic';

// Spec §5.5/§11 — every discovered project, even unmapped/unbilled ones.
// Server Component: reads straight from the DB, no client-side fetch needed
// for a page that's just a table.
export default async function GoogleProjectsPage() {
  const connection = await prisma.providerConnection.findFirst({
    where: { provider: 'GOOGLE_CLOUD' },
  });

  if (!connection) {
    return (
      <main className="page-shell">
        <h1 className="page-title">פרויקטי Google Cloud</h1>
        <p className="mt-2 text-sm text-stone-400">
          Google Cloud עדיין לא מחובר.{' '}
          <a href="/providers/google" className="link">
            חבר עכשיו
          </a>
          .
        </p>
      </main>
    );
  }

  const resources = await prisma.providerResource.findMany({
    where: { account: { providerConnectionId: connection.id } },
    include: { account: true, appMappings: { include: { managedApp: true } } },
    orderBy: { displayName: 'asc' },
  });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthCosts = await prisma.costRecord.groupBy({
    by: ['providerResourceId', 'currency'],
    where: { usageDate: { gte: monthStart } },
    _sum: { netCost: true },
  });
  // Grouped by currency too (spec §18 — never blend currencies into one
  // number). In practice a single GCP project bills in one currency, so
  // this is just the first (only) entry per resource, kept simple.
  const netCostByResource = new Map(
    monthCosts.map((c) => [c.providerResourceId, { amount: c._sum.netCost, currency: c.currency }]),
  );

  return (
    <main className="page-shell">
      <div className="flex items-center justify-between">
        <h1 className="page-title">פרויקטי Google Cloud</h1>
        <span className="text-xs text-stone-400">
          סנכרון אחרון: {connection.lastSyncAt ? connection.lastSyncAt.toLocaleString('he-IL') : 'טרם בוצע'}
        </span>
      </div>

      {connection.syncError && (
        <p className="mt-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/20">
          הסנכרון האחרון נכשל חלקית: {connection.syncError}
        </p>
      )}

      <div className="mt-4 card-table">
        <table className="w-full text-sm">
          <thead className="table-head hidden md:table-header-group">
            <tr>
              <th className="p-3">פרויקט</th>
              <th className="p-3">Billing Account</th>
              <th className="p-3">אתר משויך</th>
              <th className="p-3">הוצאה החודש (נטו)</th>
              <th className="p-3">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => {
              const cost = netCostByResource.get(r.id);
              const isUnmapped = r.appMappings.length === 0;
              return (
                <TableRow
                  key={r.id}
                  cells={[
                    {
                      header: 'פרויקט',
                      primary: true,
                      content: (
                        <span>
                          <div className="font-medium">{r.displayName}</div>
                          <div className="text-xs text-stone-500">{r.externalResourceId}</div>
                        </span>
                      ),
                    },
                    { header: 'Billing Account', content: r.account.displayName },
                    {
                      header: 'אתר משויך',
                      content: isUnmapped ? (
                        <span className="badge-warn">לא משויך לאתר</span>
                      ) : (
                        r.appMappings[0]?.managedApp?.name
                      ),
                    },
                    {
                      header: 'הוצאה החודש (נטו)',
                      primary: true,
                      content: cost?.amount ? `${Number(cost.amount).toFixed(2)} ${cost.currency}` : '—',
                    },
                    { header: 'סטטוס', content: r.status },
                  ]}
                />
              );
            })}
            {resources.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-stone-500">
                  לא נמצאו פרויקטים — ודא שהרצת discovery ושה-service account מורשה לראות פרויקטים.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
