'use client';

import { useState, useTransition } from 'react';

// spec §9 OpenAI connector, Phase 2. Simpler than /providers/google — no
// per-user OAuth redirect, OPENAI_ADMIN_KEY is a static org-level key set
// in the environment (Secret Manager in production), so "connect" is just
// "test the key + discover projects" in one action.
export default function ProvidersOpenAiPage() {
  const [isPending, startTransition] = useTransition();
  const [discoveryResult, setDiscoveryResult] = useState<unknown>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<unknown>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  function connect() {
    setDiscoveryError(null);
    startTransition(async () => {
      const res = await fetch('/api/openai/discover', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setDiscoveryError(data.error ?? 'החיבור נכשל');
        return;
      }
      setDiscoveryResult(data);
    });
  }

  function syncCosts() {
    setSyncError(null);
    startTransition(async () => {
      const res = await fetch('/api/openai/sync-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 90 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error ?? 'סנכרון עלויות נכשל');
        return;
      }
      setSyncResult(data);
    });
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="page-title">חיבור OpenAI</h1>
        <p className="mt-1 text-sm text-stone-400">
          דורש Admin API key (לא project key רגיל) — נוצר תחת Organization → Admin
          keys ב-platform.openai.com, ומוגדר כמשתנה סביבה{' '}
          <code dir="ltr">OPENAI_ADMIN_KEY</code>. אין אפשרות להזין אותו כאן מטעמי
          אבטחה.
        </p>
      </div>

      <section className="card">
        <h2 className="font-medium">שלב 1 — חיבור + גילוי פרויקטים</h2>
        <p className="mt-1 text-sm text-stone-400">
          בודק שה-key תקין וסורק את כל הפרויקטים בארגון שה-key רואה.
        </p>
        <button onClick={connect} disabled={isPending} className="mt-3 btn-primary">
          {isPending ? 'רץ...' : 'התחבר וגלה פרויקטים'}
        </button>

        {discoveryError && (
          <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/20">
            {discoveryError}
          </p>
        )}
        {Boolean(discoveryResult) && (
          <pre
            className="mt-3 overflow-x-auto rounded-md border border-stone-800 bg-stone-950 p-3 text-xs text-stone-300"
            dir="ltr"
          >
            {JSON.stringify(discoveryResult, null, 2)}
          </pre>
        )}
      </section>

      <section className="card">
        <h2 className="font-medium">שלב 2 — סנכרון עלויות</h2>
        <p className="mt-1 text-sm text-stone-400">
          שואב עלויות בפועל מ-OpenAI Costs API ל-90 הימים האחרונים, לכל פרויקט
          שהתגלה. אחרי החיבור הראשוני זה קורה גם אוטומטית כל 3 שעות.
        </p>
        <button onClick={syncCosts} disabled={isPending} className="mt-3 btn-primary">
          {isPending ? 'מסנכרן...' : 'סנכרן עלויות עכשיו'}
        </button>

        {syncError && (
          <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/20">
            {syncError}
          </p>
        )}
        {Boolean(syncResult) && (
          <pre
            className="mt-3 overflow-x-auto rounded-md border border-stone-800 bg-stone-950 p-3 text-xs text-stone-300"
            dir="ltr"
          >
            {JSON.stringify(syncResult, null, 2)}
          </pre>
        )}
      </section>

      <p className="text-sm">
        אחרי שהגילוי הצליח, פרויקטי OpenAI יופיעו לצד פרויקטי Google Cloud ואפשר
        למפות אותם לאתרים ב-
        <a href="/apps" className="link">
          אתרים
        </a>
        .
      </p>
    </main>
  );
}
