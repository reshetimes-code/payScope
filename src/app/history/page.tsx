import { prisma } from '@/lib/db/prisma';
import { monthProgress } from '@/lib/forecast/mtd';
import { getSiteCostRows } from '@/lib/dashboard/site-cost-table';

// See src/app/google/projects/page.tsx for why this must stay dynamic.
export const dynamic = 'force-dynamic';

const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const RENDER_TYPE_LABELS: Record<string, string> = {
  web_service: 'Web Service',
  static_site: 'Static Site',
  background_worker: 'Background Worker',
  private_service: 'Private Service',
  cron_job: 'Cron Job',
};

const RENDER_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  live: { label: 'Deployed', className: 'text-green-400' },
  available: { label: 'Available', className: 'text-green-400' },
  build_failed: { label: 'Failed deploy', className: 'text-red-400' },
  update_failed: { label: 'Failed deploy', className: 'text-red-400' },
  deploy_failed: { label: 'Failed deploy', className: 'text-red-400' },
  canceled: { label: 'Canceled', className: 'text-stone-500' },
  deactivated: { label: 'Deactivated', className: 'text-stone-500' },
  suspended: { label: 'Suspended', className: 'text-orange-400' },
  building: { label: 'Building', className: 'text-yellow-400' },
  deploying: { label: 'Deploying', className: 'text-yellow-400' },
  queued: { label: 'Queued', className: 'text-yellow-400' },
  created: { label: 'Created', className: 'text-stone-400' },
  unknown: { label: 'Unknown', className: 'text-stone-500' },
};

function formatByCurrency(byCurrency: Map<string, number>): string {
  if (byCurrency.size === 0) return '—';
  return [...byCurrency.entries()].map(([c, a]) => `${a.toFixed(2)} ${c}`).join(' + ');
}

// Owner request: a month-by-month history, one closed month per accordion
// row (open by default), each showing all three of the dashboard's
// sections — Google, Render, Claude. Only Google has real per-month cost
// data to replay this way; Render's service list and the Claude
// subscription card are both *current-state only* (Render's API exposes no
// history, and the Claude card is a fixed ongoing subscription, not a
// monthly record), so those two repeat identically in every month's
// accordion — labeled "מצב נוכחי" so that's never read as "how it looked
// back then".
export default async function HistoryPage() {
  const { monthStart: currentMonthStart } = monthProgress();

  const monthRows = await prisma.$queryRaw<{ month: Date }[]>`
    SELECT DISTINCT date_trunc('month', "usageDate") AS month
    FROM cost_records
    WHERE "usageDate" < ${currentMonthStart}
    ORDER BY month DESC
  `;

  const months = await Promise.all(
    monthRows.map(async ({ month }) => {
      const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
      const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
      const { rows, billingAccountLabels } = await getSiteCostRows({ start, end });

      const totalByCurrency = new Map<string, number>();
      for (const r of rows) {
        if (r.spend > 0) totalByCurrency.set(r.spendCurrency, (totalByCurrency.get(r.spendCurrency) ?? 0) + r.spend);
      }

      return { start, rows, billingAccountLabels, totalByCurrency };
    }),
  );

  // Current-state snapshots for Render + Claude — same data regardless of
  // which month's accordion it's shown in, see the comment above.
  const [renderResources, renderConnection, claudeConnection] = await Promise.all([
    prisma.providerResource.findMany({
      where: { connection: { provider: 'RENDER' } },
      orderBy: { displayName: 'asc' },
    }),
    prisma.providerConnection.findFirst({ where: { provider: 'RENDER' } }),
    prisma.providerConnection.findFirst({ where: { provider: 'ANTHROPIC' } }),
  ]);
  const renderInfo = renderConnection?.metadataJson as { paymentCard?: string; bankName?: string; accountEmail?: string } | null;
  const claudeInfo = claudeConnection?.metadataJson as
    | { manualPlanName?: string; manualMonthlyCost?: number; manualCurrency?: string; manualRenewsAt?: string }
    | null;

  return (
    <main className="page-shell">
      <h1 className="page-title">היסטוריה</h1>
      <p className="page-subtitle">
        סיכום לפי חודש עבור כל חודש שהסתיים — טבלת Google היא נתון היסטורי אמיתי לאותו חודש.
        טבלאות Render ו-Claude מוצגות בכל חודש כ"מצב נוכחי" (לא נתון של אותו חודש בפועל) — לאף
        אחד מהם אין היסטוריה אמיתית לפי חודש. עמודת "תקציב"/"ניצול" ב-Google משתמשת בתקציב הנוכחי
        (הפעיל היום), לא בתקציב שהיה קבוע באותו חודש בפועל.
      </p>

      <div className="mt-4 space-y-2">
        {months.map(({ start, rows, billingAccountLabels, totalByCurrency }) => (
          <details key={start.toISOString()} open className="card-table group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 transition-colors hover:bg-stone-800/40 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-medium text-stone-200">
                {MONTHS_HE[start.getUTCMonth()]} {start.getUTCFullYear()}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm font-medium text-stone-300">{formatByCurrency(totalByCurrency)}</span>
                <svg
                  className="h-4 w-4 shrink-0 text-stone-500 transition-transform group-open:rotate-180"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>

            <div className="space-y-6 border-t border-stone-800 p-4">
              {/* Google — real data for this specific month */}
              <div>
                <h3 className="text-xs font-medium text-stone-400">שרת Google</h3>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="table-head hidden md:table-header-group">
                      <tr>
                        <th className="p-3">אתר</th>
                        <th className="p-3">חשבון חיוב</th>
                        <th className="p-3">משאבים</th>
                        <th className="p-3">הוצאה</th>
                        <th className="p-3">תקציב (נוכחי)</th>
                        <th className="p-3">ניצול</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const percent = r.utilizationPercent;
                        return (
                          <tr key={r.id} className="border-t border-stone-800">
                            <td className="p-3 font-medium text-stone-100">{r.name}</td>
                            <td className="p-3 text-xs text-stone-400">
                              {r.billingAccounts.length === 0
                                ? '—'
                                : r.billingAccounts
                                    .map((a) => billingAccountLabels.get(a.externalAccountId))
                                    .join(', ')}
                            </td>
                            <td className="p-3 text-stone-400">{r.resourceCount}</td>
                            <td className="p-3 font-medium text-stone-100">
                              {r.spend > 0 ? `${r.spend.toFixed(2)} ${r.spendCurrency}` : '—'}
                            </td>
                            <td className="p-3 text-stone-400">
                              {r.budgetAmount != null ? `${r.budgetAmount.toFixed(2)} ${r.budgetCurrency}` : '—'}
                            </td>
                            <td className="p-3">
                              {percent == null ? (
                                <span className="text-stone-700">—</span>
                              ) : (
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
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Render — current state, not a historical record for this month */}
              {renderResources.length > 0 && (
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-xs font-medium text-stone-400">שרת RENDER</h3>
                    <span className="rounded-full bg-stone-800 px-2 py-0.5 text-[11px] text-stone-500">
                      מצב נוכחי — לא נתון היסטורי לחודש זה
                    </span>
                  </div>
                  {renderInfo?.paymentCard && (
                    <p className="mt-1 text-xs text-stone-500">
                      יורד מכרטיס <span className="font-medium text-stone-300">{renderInfo.paymentCard}</span>
                      {renderInfo.bankName && ` — ${renderInfo.bankName}`}
                      {renderInfo.accountEmail && (
                        <>
                          {' '}
                          · תחת חשבון מייל <span dir="ltr" className="font-medium text-stone-300">{renderInfo.accountEmail}</span>
                        </>
                      )}
                    </p>
                  )}
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="table-head hidden md:table-header-group">
                        <tr>
                          <th className="p-3">שם</th>
                          <th className="p-3">סוג</th>
                          <th className="p-3">אזור</th>
                          <th className="p-3">תוכנית</th>
                          <th className="p-3">סטטוס</th>
                        </tr>
                      </thead>
                      <tbody>
                        {renderResources.map((r) => {
                          const meta = (r.metadataJson as { type?: string; region?: string; plan?: string } | null) ?? {};
                          const typeLabel =
                            r.resourceType === 'render_postgres'
                              ? 'PostgreSQL'
                              : RENDER_TYPE_LABELS[meta.type ?? ''] ?? (meta.type ?? '—');
                          const status = RENDER_STATUS_LABELS[r.status] ?? { label: r.status, className: 'text-stone-400' };
                          return (
                            <tr key={r.id} className="border-t border-stone-800">
                              <td className="p-3 font-medium text-stone-100" dir="ltr">{r.displayName}</td>
                              <td className="p-3 text-stone-400">{typeLabel}</td>
                              <td className="p-3 text-stone-400">{meta.region ?? '—'}</td>
                              <td className="p-3 text-stone-400">{meta.plan ?? '—'}</td>
                              <td className="p-3">
                                <span className={status.className}>{status.label}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Claude — fixed subscription, not a monthly record */}
              {claudeInfo?.manualMonthlyCost != null && (
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-xs font-medium text-stone-400">חשבון Claude</h3>
                    <span className="rounded-full bg-stone-800 px-2 py-0.5 text-[11px] text-stone-500">
                      מצב נוכחי — לא נתון היסטורי לחודש זה
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <span className="text-stone-100">{claudeInfo.manualPlanName ?? '—'}</span>
                    <span className="font-medium text-stone-100">
                      {claudeInfo.manualMonthlyCost.toFixed(2)} {claudeInfo.manualCurrency ?? ''}
                    </span>
                    {claudeInfo.manualRenewsAt && (
                      <span className="text-stone-500">
                        מתחדש ב-{new Date(claudeInfo.manualRenewsAt).toLocaleDateString('he-IL')}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>
        ))}

        {months.length === 0 && (
          <div className="card text-center text-sm text-stone-500">
            אין עדיין חודשים שהסתיימו עם נתוני עלות — ההיסטוריה תופיע כאן אחרי החודש הראשון המלא.
          </div>
        )}
      </div>
    </main>
  );
}
