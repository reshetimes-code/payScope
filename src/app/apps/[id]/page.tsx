import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { AddMappingForm } from '@/components/add-mapping-form';
import { RemoveMappingButton } from '@/components/remove-mapping-button';
import { HardStopTargetForm } from '@/components/hard-stop-target-form';
import { TableRow } from '@/components/table-row';
import { monthProgress, projectedMonthEnd } from '@/lib/forecast/mtd';

// See src/app/google/projects/page.tsx for why this must stay dynamic.
export const dynamic = 'force-dynamic';

export default async function AppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const app = await prisma.managedApp.findUnique({
    where: { id },
    include: {
      resourceMappings: { include: { providerResource: { include: { account: true } } } },
      budgets: true,
    },
  });

  if (!app) notFound();

  const { monthStart, elapsedDays, totalDays } = monthProgress();
  const now = new Date();
  const prevMonthEnd = new Date(monthStart);
  prevMonthEnd.setUTCMilliseconds(-1);
  const prevMonthStart = new Date(Date.UTC(prevMonthEnd.getUTCFullYear(), prevMonthEnd.getUTCMonth(), 1));

  const [costs, prevMonthCosts, serviceBreakdown, lastImported] = await Promise.all([
    prisma.costRecord.aggregate({
      where: { managedAppId: id, usageDate: { gte: monthStart } },
      _sum: { netCost: true, grossCost: true, credits: true },
    }),
    prisma.costRecord.aggregate({
      where: { managedAppId: id, usageDate: { gte: prevMonthStart, lt: monthStart } },
      _sum: { netCost: true },
    }),
    // "לאן מחובר, כמה עולה" — real per-service breakdown (Cloud Run, Cloud
    // SQL, Storage, Gemini/Generative Language API, Firebase, etc.), not a
    // guess: this is exactly the `service` field Google's own billing
    // export reports, grouped and summed for this site's mapped project(s).
    prisma.costRecord.groupBy({
      by: ['service'],
      where: { managedAppId: id, usageDate: { gte: monthStart } },
      _sum: { netCost: true },
      orderBy: { _sum: { netCost: 'desc' } },
    }),
    prisma.costRecord.findFirst({
      where: { managedAppId: id },
      orderBy: { importedAt: 'desc' },
      select: { importedAt: true, currency: true },
    }),
  ]);

  const netCost = Number(costs._sum.netCost ?? 0);
  const forecast = projectedMonthEnd(netCost, elapsedDays, totalDays);
  const prevMonthTotal = Number(prevMonthCosts._sum.netCost ?? 0);
  // A GCP project bills in one currency, so this is the site's currency for
  // display purposes — falls back to a placeholder when there's no cost
  // data yet to read it from.
  const currency = lastImported?.currency ?? '';

  const unmappedResources = await prisma.providerResource.findMany({
    where: { resourceType: 'gcp_project', appMappings: { none: {} } },
    select: { id: true, displayName: true, externalResourceId: true },
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="page-title">{app.name}</h1>
        {app.domain && <p className="text-sm text-stone-400">{app.domain}</p>}
        {lastImported && (
          <p className="mt-1 text-xs text-stone-500">
            עלויות עודכנו לאחרונה: {lastImported.importedAt.toLocaleString('he-IL')}
          </p>
        )}
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card">
          <div className="text-xs text-stone-400">הוצאה החודש (נטו)</div>
          <div className="mt-1 text-lg font-semibold">
            {netCost.toFixed(2)} {currency}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-stone-400">תחזית לסוף החודש</div>
          <div className="mt-1 text-lg font-semibold">
            {forecast.toFixed(2)} {currency}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-stone-400">חודש קודם</div>
          <div className="mt-1 text-lg font-semibold">
            {prevMonthTotal.toFixed(2)} {currency}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-stone-400">תקציבים מוגדרים</div>
          <div className="mt-1 text-lg font-semibold">{app.budgets.length}</div>
        </div>
      </section>
      <p className="-mt-4 text-xs text-stone-500">
        ברוטו: {Number(costs._sum.grossCost ?? 0).toFixed(2)} {currency} | זיכויים:{' '}
        {Number(costs._sum.credits ?? 0).toFixed(2)} {currency} | תחזית = הערכה לפי קצב הוצאה
        עד כה, לא הבטחה (§5.8 בספק).
      </p>

      <section className="card">
        <h2 className="font-medium">לאן מחובר האתר, וכמה כל דבר עולה</h2>
        <p className="mt-1 text-xs text-stone-400">
          פירוט אמיתי מתוך Google Billing — כל שירות שהאתר משתמש בו (שרת,
          מסד נתונים, אחסון, Gemini/AI, Firebase וכו') תחת הפרויקטים הממופים
          אליו, לא ניחוש.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead className="text-right text-xs text-stone-400">
            <tr>
              <th className="p-2">שירות</th>
              <th className="p-2">הוצאה החודש</th>
              <th className="p-2">% מהסה"כ</th>
            </tr>
          </thead>
          <tbody>
            {serviceBreakdown.map((row) => {
              const value = Number(row._sum.netCost ?? 0);
              const percent = netCost > 0 ? (value / netCost) * 100 : 0;
              return (
                <tr key={row.service} className="border-t border-stone-800">
                  <td className="p-2">{row.service || 'לא מסווג'}</td>
                  <td className="p-2">
                    {value.toFixed(2)} {currency}
                  </td>
                  <td className="p-2 text-xs text-stone-400">{percent.toFixed(0)}%</td>
                </tr>
              );
            })}
            {serviceBreakdown.length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 text-center text-sm text-stone-500">
                  אין עדיין נתוני עלות לאתר זה — לחץ "סנכרן עלויות עכשיו" ב
                  <a href="/dashboard" className="link">
                    לוח הבקרה
                  </a>
                  .
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="font-medium">משאבים ממופים</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="hidden text-right text-xs text-stone-400 md:table-header-group">
            <tr>
              <th className="p-2">משאב</th>
              <th className="p-2">ספק</th>
              <th className="p-2">שיוך</th>
              <th className="p-2">רמת דיוק</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {app.resourceMappings.map((m) => (
              <TableRow
                key={m.id}
                cells={[
                  {
                    header: 'משאב',
                    primary: true,
                    content: (
                      <span>
                        {m.providerResource.displayName}
                        <div className="text-xs text-stone-500">{m.providerResource.externalResourceId}</div>
                      </span>
                    ),
                  },
                  { header: 'ספק', content: m.providerResource.account.displayName },
                  {
                    header: 'שיוך',
                    content: m.allocationMode === 'FULL' ? 'מלא' : `${m.allocationPercent ?? '?'}%`,
                  },
                  {
                    header: 'רמת דיוק',
                    primary: true,
                    content:
                      m.confidence === 'EXACT' ? (
                        <span className="badge-ok">מדויק</span>
                      ) : (
                        <span className="badge-warn">משוער</span>
                      ),
                  },
                  {
                    header: '',
                    content: (
                      <RemoveMappingButton
                        managedAppId={app.id}
                        providerResourceId={m.providerResource.id}
                      />
                    ),
                  },
                ]}
              />
            ))}
            {app.resourceMappings.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-sm text-stone-500">
                  אין עדיין משאבים ממופים לאתר זה.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="font-medium">מפה פרויקט Google Cloud לאתר זה</h2>
        <div className="mt-3">
          <AddMappingForm managedAppId={app.id} unmappedResources={unmappedResources} />
        </div>
      </section>

      <section className="card">
        <h2 className="font-medium">יעד Hard Stop</h2>
        <p className="mt-1 text-xs text-stone-400">
          איזה Cloud Run service ייעצר אם תפעיל Hard Stop על תקציב של אתר זה
          (§34 בספק). הגדרת יעד לא מפעילה כלום בעצמה — ההפעלה בפועל נעשית
          בעמוד <a href="/budgets" className="link">תקציבים</a> עם אישור מפורש.
        </p>
        <div className="mt-3">
          <HardStopTargetForm
            managedAppId={app.id}
            currentRegion={app.hardStopCloudRunRegion}
            currentServiceName={app.hardStopCloudRunServiceName}
          />
        </div>
      </section>
    </main>
  );
}
