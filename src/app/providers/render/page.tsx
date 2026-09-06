'use client';

import { useState, useTransition } from 'react';

// Render connector — owner request: visibility into Render-hosted sites
// alongside Google Cloud. No cost sync (Render bills flat-rate per plan,
// not metered usage — there's no per-resource cost API to read), so this
// is inventory only: one action tests the key and lists every service +
// Postgres instance.
export default function ProvidersRenderPage() {
  const [isPending, startTransition] = useTransition();
  const [discoveryResult, setDiscoveryResult] = useState<unknown>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  function connect() {
    setDiscoveryError(null);
    startTransition(async () => {
      const res = await fetch('/api/render/discover', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setDiscoveryError(data.error ?? 'החיבור נכשל');
        return;
      }
      setDiscoveryResult(data);
    });
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="page-title">חיבור Render</h1>
        <p className="mt-1 text-sm text-stone-400">
          דורש API Key — נוצר תחת Account Settings → API Keys ב-dashboard.render.com,
          ומוגדר כמשתנה סביבה <code dir="ltr">RENDER_API_KEY</code>. אין אפשרות להזין
          אותו כאן מטעמי אבטחה.
        </p>
      </div>

      <section className="card">
        <h2 className="font-medium">חיבור + גילוי שירותים</h2>
        <p className="mt-1 text-sm text-stone-400">
          בודק שה-key תקין וסורק את כל ה-Web Services, Static Sites, ומסדי ה-Postgres
          שה-key רואה. אין ל-Render API לעלויות בפועל (התמחור שם הוא לפי תוכנית קבועה,
          לא שימוש נמדד) — זה חיבור לצורך אינדיקציה בלבד, לא מעקב עלויות.
        </p>
        <button onClick={connect} disabled={isPending} className="mt-3 btn-primary">
          {isPending ? 'רץ...' : 'התחבר וגלה שירותים'}
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

      <p className="text-sm">
        אחרי שהגילוי הצליח, שירותי Render יופיעו בלוח הבקרה תחת "שרת RENDER".
      </p>
    </main>
  );
}
