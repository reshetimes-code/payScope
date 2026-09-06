'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function HardStopTargetForm({
  managedAppId,
  currentRegion,
  currentServiceName,
}: {
  managedAppId: string;
  currentRegion: string | null;
  currentServiceName: string | null;
}) {
  const router = useRouter();
  const [region, setRegion] = useState(currentRegion ?? '');
  const [serviceName, setServiceName] = useState(currentServiceName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/apps/${managedAppId}/hard-stop-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region, serviceName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'שמירת היעד נכשלה');
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-xs text-stone-400">אזור (region)</label>
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="me-west1"
          dir="ltr"
          required
          className="mt-1 w-40 field"
        />
      </div>
      <div className="flex-1">
        <label className="block text-xs text-stone-400">שם Cloud Run service</label>
        <input
          value={serviceName}
          onChange={(e) => setServiceName(e.target.value)}
          placeholder="mishpatly-web"
          dir="ltr"
          required
          className="mt-1 w-full field"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary"
      >
        {isPending ? 'שומר...' : 'שמור יעד'}
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
      <p className="w-full text-xs text-stone-500">
        זה קובע איזה Cloud Run service ייעצר (max-instances=0) אם Hard Stop יופעל
        ויגיע לרף. לא ניתן לגזור זאת אוטומטית מנתוני החיוב — יש להזין ידנית.
      </p>
    </form>
  );
}
