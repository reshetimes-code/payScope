'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface UnmappedResource {
  id: string;
  displayName: string;
  externalResourceId: string;
}

export function AddMappingForm({
  managedAppId,
  unmappedResources,
}: {
  managedAppId: string;
  unmappedResources: UnmappedResource[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(unmappedResources[0]?.id ?? '');
  const [allocationMode, setAllocationMode] = useState<'FULL' | 'PERCENTAGE'>('FULL');
  const [allocationPercent, setAllocationPercent] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (unmappedResources.length === 0) {
    return (
      <p className="text-sm text-stone-500">
        אין פרויקטי Google Cloud לא-ממופים זמינים למיפוי כרגע.
      </p>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/apps/${managedAppId}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerResourceId: selected,
          allocationMode,
          allocationPercent: allocationMode === 'PERCENTAGE' ? allocationPercent : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'המיפוי נכשל');
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1">
        <label className="block text-xs text-stone-400">פרויקט Google Cloud</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="mt-1 w-full field"
        >
          {unmappedResources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.displayName} ({r.externalResourceId})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-stone-400">שיוך</label>
        <select
          value={allocationMode}
          onChange={(e) => setAllocationMode(e.target.value as 'FULL' | 'PERCENTAGE')}
          className="mt-1 field"
        >
          <option value="FULL">מלא (מדויק)</option>
          <option value="PERCENTAGE">אחוז (משוער)</option>
        </select>
      </div>

      {allocationMode === 'PERCENTAGE' && (
        <div>
          <label className="block text-xs text-stone-400">אחוז</label>
          <input
            type="number"
            min={0}
            max={100}
            value={allocationPercent}
            onChange={(e) => setAllocationPercent(Number(e.target.value))}
            className="mt-1 w-24 field"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="btn-primary"
      >
        {isPending ? 'ממפה...' : 'מפה'}
      </button>

      {error && <p className="w-full text-sm text-red-400">{error}</p>}
      {allocationMode === 'PERCENTAGE' && (
        <p className="w-full text-xs text-orange-400">
          שיוך חלקי מוצג תמיד כ"משוער" — לא ניתן לדעת עלות מדויקת לאתר בודד כשמשאב
          משותף בין כמה אתרים ללא תיוג ברור (§2 בספק).
        </p>
      )}
    </form>
  );
}
