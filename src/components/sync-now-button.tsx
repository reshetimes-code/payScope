'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

// Same Google endpoints as /providers/google steps 2-3 — duplicated here so
// the dashboard itself can trigger a full sync without navigating away,
// since that's the single action most likely needed right after opening the
// home page. Runs Google discovery *before* the cost sync (sequentially, not
// in parallel) — a newly-added GCP project has to exist as a ProviderResource
// row before sync-costs can attach cost records to it; otherwise it's the
// exact "פרויקט לא מוכר" case runGoogleCostSync deliberately errors on. A
// discovery failure is logged but doesn't block the cost sync from running
// against whatever was already known — same soft-fail treatment as Render's
// own discovery call below.
// Also fires Render discovery in parallel (owner request — clicking this
// used to leave the Render service/status table stale for up to 3 hours,
// until the next scheduled sync). Render has no cost API at all, so this
// only ever refreshes its service inventory/status, never a cost number —
// see lib/providers/render/adapter.ts.
async function readJsonSafely(res: Response): Promise<{ error?: string }> {
  // A gateway timeout (504) or similar infra-level failure returns a
  // plain-text/HTML body, not JSON — res.json() would throw and crash the
  // whole page (this is exactly what caused "This page couldn't load"
  // instead of a normal error message). Read as text first and only parse
  // if it looks like JSON.
  const raw = await res.text();
  return raw ? JSON.parse(raw) : {};
}

export function SyncNowButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function runGoogleSync(): Promise<void> {
    // Best-effort — a project newly added in GCP Console has to become a
    // ProviderResource here before sync-costs can attach anything to it, but
    // a discovery hiccup (e.g. a transient Resource Manager error) shouldn't
    // stop us from refreshing costs for every project already known.
    try {
      const discoverRes = await fetch('/api/google/discover', { method: 'POST' });
      const discoverData = await readJsonSafely(discoverRes);
      if (!discoverRes.ok) {
        console.error(
          'Google discovery failed during dashboard sync:',
          typeof discoverData.error === 'string' ? discoverData.error : discoverRes.status,
        );
      }
    } catch (err) {
      console.error('Google discovery failed during dashboard sync:', err);
    }

    const costRes = await fetch('/api/google/sync-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 90 }),
    });
    const costData = await readJsonSafely(costRes);
    if (!costRes.ok) {
      throw new Error(typeof costData.error === 'string' ? costData.error : `Google (${costRes.status})`);
    }
  }

  function sync() {
    setError(null);
    startTransition(async () => {
      try {
        const [googleRes, renderRes] = await Promise.allSettled([
          runGoogleSync(),
          fetch('/api/render/discover', { method: 'POST' }).then(async (res) => {
            const data = await readJsonSafely(res);
            if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `Render (${res.status})`);
          }),
        ]);

        // Google is the one this button's copy promises ("סנכרן עלויות") —
        // its failure is the real error. Render discovery failing (e.g. no
        // RENDER_API_KEY configured yet) is reported but doesn't block the
        // page refresh, since Google's numbers are still fresh either way.
        if (googleRes.status === 'rejected') {
          setError(googleRes.reason instanceof Error ? googleRes.reason.message : 'הסנכרון נכשל');
          return;
        }
        if (renderRes.status === 'rejected') {
          console.error('Render discovery failed during dashboard sync:', renderRes.reason);
        }
        router.refresh();
      } catch {
        // Network error we couldn't parse (e.g. a 504 from the platform
        // itself, not from our own code) — the sync may still be running
        // server-side; it isn't lost, just not confirmed here.
        setError('הסנכרון לא אישר סיום — ייתכן שהוא עדיין רץ ברקע. נסה לרענן בעוד דקה.');
      }
    });
  }

  return (
    <div>
      <button onClick={sync} disabled={isPending} className="btn-primary">
        {isPending ? 'מסנכרן...' : 'סנכרן עלויות עכשיו'}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {isPending && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#100d0b]/80 backdrop-blur-sm">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-stone-700 border-t-purple-500" />
          <p className="text-sm font-medium text-stone-200">מגלה פרויקטים חדשים ומסנכרן עלויות מ-Google Cloud…</p>
          <p className="text-xs text-stone-500">זה יכול לקחת כמה שניות</p>
        </div>
      )}
    </div>
  );
}
