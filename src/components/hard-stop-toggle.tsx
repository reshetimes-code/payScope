'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

// Spec §34.11 — enabling requires typing the exact project id back, every
// time this component is used to turn it on. Disabling is one click; making
// the system safer never needs friction, only making it more dangerous does.
export function HardStopToggle({
  budgetId,
  projectExternalId,
  enabled,
  hasTarget,
  suspended,
}: {
  budgetId: string;
  projectExternalId: string;
  enabled: boolean;
  hasTarget: boolean;
  suspended: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typedId, setTypedId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resume() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/budgets/${budgetId}/resume`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'ההפעלה מחדש נכשלה');
        return;
      }
      router.refresh();
    });
  }

  function disable() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/budgets/${budgetId}/hard-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(typeof data.error === 'string' ? data.error : 'הביטול נכשל');
        return;
      }
      router.refresh();
    });
  }

  function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/budgets/${budgetId}/hard-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, confirmProjectId: typedId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'ההפעלה נכשלה');
        return;
      }
      setConfirming(false);
      setTypedId('');
      router.refresh();
    });
  }

  if (suspended) {
    return (
      <div className="text-xs">
        <span className="badge-danger font-medium">🔴 מושהה</span>
        <button
          onClick={resume}
          disabled={isPending}
          className="mr-2 underline text-stone-300 hover:text-stone-50"
        >
          {isPending ? 'מפעיל...' : 'הפעל מחדש'}
        </button>
        {error && <p className="mt-1 text-red-400">{error}</p>}
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="text-xs">
        <span className="badge-danger">Hard Stop פעיל</span>
        <button
          onClick={disable}
          disabled={isPending}
          className="mr-2 underline text-stone-400 hover:text-stone-200"
        >
          בטל
        </button>
      </div>
    );
  }

  if (!hasTarget) {
    return (
      <span className="text-xs text-stone-500" title="הגדר יעד Cloud Run בדף האתר לפני הפעלת Hard Stop">
        ⚠️ אין יעד מוגדר
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs underline text-stone-400 hover:text-stone-50"
      >
        הפעל Hard Stop
      </button>
    );
  }

  return (
    <form onSubmit={confirmEnable} className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
      <p className="text-xs text-red-300">
        פעולה זו תעצור אוטומטית את השירות כשמגיעים לרף הקשיח. הקלד את מזהה
        הפרויקט <b dir="ltr">{projectExternalId}</b> כדי לאשר:
      </p>
      <input
        value={typedId}
        onChange={(e) => setTypedId(e.target.value)}
        dir="ltr"
        className="w-full rounded border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-100"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending || typedId !== projectExternalId}
          className="rounded bg-red-600 px-3 py-1 text-xs text-white transition-colors hover:bg-red-500 disabled:opacity-40"
        >
          אשר הפעלה
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setTypedId('');
          }}
          className="text-xs text-stone-400 underline"
        >
          ביטול
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  );
}
