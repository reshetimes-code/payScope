import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';

// See src/app/google/projects/page.tsx for why this must stay dynamic.
export const dynamic = 'force-dynamic';

const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const PROVIDER_LABELS: Record<string, string> = {
  GOOGLE_CLOUD: 'Google Cloud',
  RENDER: 'Render',
};

interface GoogleBreakdownEntry {
  billingAccountId: string;
  billingAccountName: string;
  amount: number;
  currency: string;
}

interface RenderBreakdownEntry {
  name: string;
  amount: number;
}

// Owner request: a monthly invoices table, presentable to whoever pays for
// the sites — one row per (provider, calendar month) for the whole org
// (reshetimes-org). GOOGLE_CLOUD rows are auto-generated from cost data
// already synced from Google's BigQuery billing export (Google exposes no
// API for its own invoice PDF, only a Console download — see
// generate-invoices Cloud Scheduler job). RENDER rows are entered manually
// once a month via "הוסף חשבונית Render" — Render exposes no cost API at
// all, live or historical (see Invoice model comment in schema.prisma).
export default async function InvoicesPage() {
  const invoices = await prisma.invoice.findMany({
    orderBy: [{ periodStart: 'desc' }, { provider: 'asc' }],
  });

  return (
    <main className="page-shell">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">חשבוניות</h1>
        <Link href="/invoices/render/new" className="btn-secondary">
          + הוסף חשבונית Render
        </Link>
      </div>
      <p className="page-subtitle">
        סיכום חיוב חודשי עבור <span dir="ltr">reshetimes-org</span> — שורה לכל ספק לכל חודש. חשבוניות{' '}
        <span dir="ltr">Google Cloud</span> נוצרות אוטומטית מנתוני עלות שכבר מסונכרנים; חשבוניות{' '}
        <span dir="ltr">Render</span> מוזנות ידנית (ל-Render אין API לעלויות בכלל). זו לא החשבונית הרשמית של אף
        ספק — סיכום פנימי לצורכי מעקב והצגה.
      </p>

      <div className="mt-4 space-y-3">
        {invoices.map((inv) => {
          const isGoogle = inv.provider === 'GOOGLE_CLOUD';
          const googleBreakdown = isGoogle ? ((inv.breakdownJson as unknown as GoogleBreakdownEntry[] | null) ?? []) : [];
          const renderBreakdown = !isGoogle ? ((inv.breakdownJson as unknown as RenderBreakdownEntry[] | null) ?? []) : [];

          return (
            <div key={inv.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-stone-500">
                    <span dir="ltr">reshetimes-org</span>
                    <span className="rounded-full bg-stone-800 px-2 py-0.5 text-stone-400" dir="ltr">
                      {PROVIDER_LABELS[inv.provider] ?? inv.provider}
                    </span>
                  </div>
                  <div className="mt-0.5 text-lg font-semibold text-stone-50">
                    {MONTHS_HE[inv.periodStart.getUTCMonth()]} {inv.periodStart.getUTCFullYear()}
                  </div>
                  <div className="mt-1 text-xs text-stone-500">
                    הופק ב-{inv.generatedAt.toLocaleString('he-IL')}
                  </div>
                </div>
                <div className="text-left">
                  <div className="stat-value">
                    {Number(inv.totalAmount).toFixed(2)} {inv.currency}
                  </div>
                  <a href={`/api/invoices/${inv.id}/pdf`} className="link-strong mt-1 inline-block">
                    הורדת PDF
                  </a>
                </div>
              </div>

              {isGoogle && googleBreakdown.length > 0 && (
                <div className="mt-4 border-t border-stone-800 pt-3">
                  <div className="text-xs font-medium text-stone-400">פירוט לפי חשבון חיוב</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {googleBreakdown.map((b) => (
                      <div
                        key={b.billingAccountId}
                        className="rounded-md border border-stone-800 bg-stone-950/40 p-2.5 text-sm"
                      >
                        <div className="text-stone-200">{b.billingAccountName}</div>
                        <div className="text-xs text-stone-500" dir="ltr">
                          {b.billingAccountId}
                        </div>
                        <div className="mt-1 font-medium text-stone-100">
                          {b.amount.toFixed(2)} {b.currency}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isGoogle && renderBreakdown.length > 0 && (
                <div className="mt-4 border-t border-stone-800 pt-3">
                  <div className="text-xs font-medium text-stone-400">פירוט לפי שירות</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {renderBreakdown.map((b) => (
                      <div key={b.name} className="rounded-md border border-stone-800 bg-stone-950/40 p-2.5 text-sm">
                        <div className="text-stone-200" dir="ltr">
                          {b.name}
                        </div>
                        <div className="mt-1 font-medium text-stone-100">
                          {b.amount.toFixed(2)} {inv.currency}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {invoices.length === 0 && (
          <div className="card text-center text-sm text-stone-500">
            אין עדיין חשבוניות — חשבוניות Google נוצרות אוטומטית בתחילת כל חודש, וחשבוניות Render מוזנות ב
            <Link href="/invoices/render/new" className="link mx-1">
              הוספת חשבונית Render
            </Link>
            .
          </div>
        )}
      </div>
    </main>
  );
}
