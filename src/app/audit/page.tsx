import { prisma } from '@/lib/db/prisma';
import { TableRow } from '@/components/table-row';

// See src/app/google/projects/page.tsx for why this must stay dynamic.
export const dynamic = 'force-dynamic';

// Spec §4 — audit log for every sensitive action. The data already exists
// (src/lib/audit/log.ts is called from every state-changing route); this
// page just reads it.
export default async function AuditPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <main className="page-shell">
      <h1 className="page-title">יומן ביקורת</h1>
      <p className="mt-1 text-sm text-stone-400">200 הפעולות האחרונות, מהחדשה לישנה.</p>

      <div className="mt-4 card-table">
        <table className="w-full text-sm">
          <thead className="table-head hidden md:table-header-group">
            <tr>
              <th className="p-3">זמן</th>
              <th className="p-3">מבצע</th>
              <th className="p-3">פעולה</th>
              <th className="p-3">משאב</th>
              <th className="p-3">תוצאה</th>
              <th className="p-3">שגיאה</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <TableRow
                key={log.id}
                cells={[
                  {
                    header: 'זמן',
                    content: (
                      <span className="whitespace-nowrap text-xs text-stone-400">
                        {log.createdAt.toLocaleString('he-IL')}
                      </span>
                    ),
                  },
                  { header: 'מבצע', content: log.actorLabel },
                  {
                    header: 'פעולה',
                    primary: true,
                    content: (
                      <span dir="ltr">
                        {log.action}
                      </span>
                    ),
                  },
                  {
                    header: 'משאב',
                    content: (
                      <span className="text-xs text-stone-400" dir="ltr">
                        {log.resource ?? '—'}
                      </span>
                    ),
                  },
                  {
                    header: 'תוצאה',
                    primary: true,
                    content:
                      log.result === 'SUCCESS' ? (
                        <span className="badge-ok">הצלחה</span>
                      ) : (
                        <span className="badge-danger">כישלון</span>
                      ),
                  },
                  {
                    header: 'שגיאה',
                    className: 'max-w-xs truncate',
                    content: (
                      <span className="text-xs text-red-400" title={log.errorSummary ?? ''}>
                        {log.errorSummary ?? ''}
                      </span>
                    ),
                  },
                ]}
              />
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-stone-500">
                  עדיין אין רשומות ביומן — כל פעולה רגישה (discovery, תקציבים, Hard
                  Stop) תופיע כאן.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
