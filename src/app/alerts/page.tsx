import { prisma } from '@/lib/db/prisma';
import { AcknowledgeAlertButton } from '@/components/acknowledge-alert-button';
import { TableRow } from '@/components/table-row';

// See src/app/google/projects/page.tsx for why this must stay dynamic.
export const dynamic = 'force-dynamic';

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/30',
  HIGH: 'bg-orange-500/10 text-orange-400 ring-1 ring-inset ring-orange-500/30',
  WARNING: 'bg-yellow-500/10 text-yellow-400 ring-1 ring-inset ring-yellow-500/30',
  INFO: 'bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/30',
};

const SEVERITY_LABEL: Record<string, string> = {
  CRITICAL: 'קריטי',
  HIGH: 'גבוה',
  WARNING: 'אזהרה',
  INFO: 'מידע',
};

// Spec §14 — alert history. Rows already exist (written by
// src/lib/alerts/evaluate-budgets.ts and execute-hard-stops.ts); this page
// just lists and lets you acknowledge them.
export default async function AlertsPage() {
  const alerts = await prisma.alert.findMany({
    orderBy: [{ status: 'asc' }, { firstDetectedAt: 'desc' }],
    take: 200,
  });

  return (
    <main className="page-shell">
      <h1 className="page-title">התראות</h1>
      <p className="page-subtitle">חריגות תקציב ואירועי Hard Stop. פתוחות (OPEN) מוצגות ראשונות.</p>

      <div className="mt-4 card-table">
        <table className="w-full text-sm">
          <thead className="table-head hidden md:table-header-group">
            <tr>
              <th className="p-3">חומרה</th>
              <th className="p-3">כותרת</th>
              <th className="p-3">פירוט</th>
              <th className="p-3">זוהה לראשונה</th>
              <th className="p-3">סטטוס</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <TableRow
                key={alert.id}
                cells={[
                  {
                    header: 'חומרה',
                    primary: true,
                    content: (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs ${SEVERITY_STYLE[alert.severity] ?? 'bg-stone-500/10 text-stone-400 ring-1 ring-inset ring-stone-500/20'}`}
                      >
                        {SEVERITY_LABEL[alert.severity] ?? alert.severity}
                      </span>
                    ),
                  },
                  {
                    header: 'כותרת',
                    primary: true,
                    content: <span className="font-medium text-stone-100">{alert.title}</span>,
                  },
                  {
                    header: 'פירוט',
                    content: <span className="text-xs text-stone-400">{alert.body}</span>,
                  },
                  {
                    header: 'זוהה לראשונה',
                    content: (
                      <span className="whitespace-nowrap text-xs text-stone-400">
                        {alert.firstDetectedAt.toLocaleString('he-IL')}
                      </span>
                    ),
                  },
                  {
                    header: 'סטטוס',
                    content:
                      alert.status === 'OPEN' ? (
                        <span className="badge-danger">פתוחה</span>
                      ) : alert.status === 'ACKNOWLEDGED' ? (
                        <span className="badge-neutral">טופלה</span>
                      ) : (
                        <span className="badge-ok">נפתרה</span>
                      ),
                  },
                  {
                    header: '',
                    content: alert.status === 'OPEN' && <AcknowledgeAlertButton alertId={alert.id} />,
                  },
                ]}
              />
            ))}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-stone-500">
                  אין עדיין התראות.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
