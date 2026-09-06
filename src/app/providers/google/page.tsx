'use client';

import { useState, useTransition } from 'react';

// Setup wizard steps 2-4 condensed onto one page for now (spec §17) — a
// full multi-step wizard UI is still pending; this page already does the
// real work (discovery + billing-export test), just without the guided
// step-by-step chrome yet. See README "Next steps".
export default function ProvidersGooglePage() {
  const [isPending, startTransition] = useTransition();
  const [discoveryResult, setDiscoveryResult] = useState<unknown>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [billingAccountId, setBillingAccountId] = useState('');
  const [exportResult, setExportResult] = useState<unknown>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<unknown>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  function runDiscovery() {
    setDiscoveryError(null);
    startTransition(async () => {
      const res = await fetch('/api/google/discover', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setDiscoveryError(data.error ?? 'Discovery failed');
        return;
      }
      setDiscoveryResult(data);
    });
  }

  function testBillingExport() {
    setExportError(null);
    startTransition(async () => {
      const res = await fetch('/api/google/billing-export/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingAccountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExportError(data.error ?? 'Billing export test failed');
        return;
      }
      setExportResult(data);
    });
  }

  function syncCosts() {
    setSyncError(null);
    startTransition(async () => {
      const res = await fetch('/api/google/sync-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 90 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error ?? 'Cost sync failed');
        return;
      }
      setSyncResult(data);
    });
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="page-title">חיבור Google Cloud</h1>
        <p className="mt-1 text-sm text-stone-400">
          המערכת משתמשת בזהות שמחוברת ל-Cloud Run (workload identity) כברירת מחדל —
          ראו DECISIONS.md. אין צורך להעלות מפתח כדי להתחיל, בתנאי שההרשאות ברמת
          הארגון/billing account כבר הוענקו לזהות הזו.
        </p>
      </div>

      <section className="card">
        <h2 className="font-medium">שלב 1 — גילוי (Discovery)</h2>
        <p className="mt-1 text-sm text-stone-400">
          סורק את כל חשבונות ה-billing והפרויקטים שהזהות המחוברת רואה.
        </p>
        <button
          onClick={runDiscovery}
          disabled={isPending}
          className="mt-3 btn-primary"
        >
          {isPending ? 'רץ...' : 'הרץ Discovery'}
        </button>

        {discoveryError && (
          <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/20">{discoveryError}</p>
        )}
        {Boolean(discoveryResult) && (
          <pre className="mt-3 overflow-x-auto rounded-md border border-stone-800 bg-stone-950 p-3 text-xs text-stone-300" dir="ltr">
            {JSON.stringify(discoveryResult, null, 2)}
          </pre>
        )}
      </section>

      <section className="card">
        <h2 className="font-medium">שלב 2 — בדיקת Billing Export</h2>
        <p className="mt-1 text-sm text-stone-400">
          בדוק שה-billing export ל-BigQuery מוגדר עבור billing account (נדרש למעקב
          עלויות אמיתי, ראו §5.3 בספק).
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={billingAccountId}
            onChange={(e) => setBillingAccountId(e.target.value)}
            placeholder="012345-6789AB-CDEF01"
            dir="ltr"
            className="flex-1 field"
          />
          <button
            onClick={testBillingExport}
            disabled={isPending || !billingAccountId}
            className="btn-primary"
          >
            בדוק
          </button>
        </div>

        {exportError && (
          <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/20">{exportError}</p>
        )}
        {Boolean(exportResult) && (
          <pre className="mt-3 overflow-x-auto rounded-md border border-stone-800 bg-stone-950 p-3 text-xs text-stone-300" dir="ltr">
            {JSON.stringify(exportResult, null, 2)}
          </pre>
        )}
      </section>

      <section className="card">
        <h2 className="font-medium">שלב 3 — סנכרון עלויות</h2>
        <p className="mt-1 text-sm text-stone-400">
          שואב עלויות בפועל מ-BigQuery ל-90 הימים האחרונים לכל חשבונות ה-billing
          שהתגלו, ומעריך תקציבים/התראות על הנתונים הטריים (המקבילה הידנית ל-cron
          הפנימי, spec §16).
        </p>
        <button
          onClick={syncCosts}
          disabled={isPending}
          className="mt-3 btn-primary"
        >
          {isPending ? 'מסנכרן...' : 'סנכרן עלויות עכשיו'}
        </button>

        {syncError && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/20">{syncError}</p>}
        {Boolean(syncResult) && (
          <pre className="mt-3 overflow-x-auto rounded-md border border-stone-800 bg-stone-950 p-3 text-xs text-stone-300" dir="ltr">
            {JSON.stringify(syncResult, null, 2)}
          </pre>
        )}
      </section>

      <p className="text-sm">
        אחרי שהגילוי הצליח, המשך אל{' '}
        <a href="/google/projects" className="link">
          פרויקטי Google Cloud
        </a>{' '}
        כדי לראות עלויות ולהגדיר תקציבים.
      </p>
    </main>
  );
}
