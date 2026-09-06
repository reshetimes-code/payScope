'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface UnbudgetedResource {
  providerResourceId: string;
  displayName: string;
  externalResourceId: string;
  billingAccountId: string;
}

const DEFAULT_THRESHOLDS = [50, 75, 90, 100];

export function BudgetForm({ unbudgetedResources }: { unbudgetedResources: UnbudgetedResource[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(unbudgetedResources[0]?.providerResourceId ?? '');
  const [amount, setAmount] = useState(100);
  const [currency, setCurrency] = useState('ILS');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (unbudgetedResources.length === 0) {
    return <p className="text-sm text-stone-500">לכל הפרויקטים המגולים כבר יש תקציב.</p>;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const resource = unbudgetedResources.find((r) => r.providerResourceId === selected);
    if (!resource) return;

    startTransition(async () => {
      const res = await fetch('/api/google/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingAccountId: resource.billingAccountId,
          projectExternalId: resource.externalResourceId,
          amount,
          currency,
          thresholdsPercent: DEFAULT_THRESHOLDS,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'הגדרת התקציב נכשלה');
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1">
        <label className="block text-xs text-stone-400">פרויקט</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="mt-1 w-full field"
        >
          {unbudgetedResources.map((r) => (
            <option key={r.providerResourceId} value={r.providerResourceId}>
              {r.displayName} ({r.externalResourceId})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-stone-400">תקציב חודשי</label>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="mt-1 w-28 field"
        />
      </div>
      <div>
        <label className="block text-xs text-stone-400">מטבע</label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="mt-1 field"
        >
          <option value="ILS">ILS</option>
          <option value="USD">USD</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary"
      >
        {isPending ? 'שומר...' : 'הגדר תקציב'}
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
      <p className="w-full text-xs text-stone-500">
        ספי התראה ברירת מחדל: 50% / 75% / 90% / 100% (ניתן לשנות בהמשך).
      </p>
    </form>
  );
}
