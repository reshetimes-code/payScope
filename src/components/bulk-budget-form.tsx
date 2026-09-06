'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface BulkResult {
  site: string;
  ok: boolean;
  message: string;
}

// Spec §13 bulk action — set the same monthly budget across every mapped
// site that doesn't already have one, in one click instead of 9.
export function BulkBudgetForm() {
  const router = useRouter();
  const [amount, setAmount] = useState(20);
  const [currency, setCurrency] = useState('ILS');
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);
    startTransition(async () => {
      const res = await fetch('/api/google/budgets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency, thresholdsPercent: [50, 75, 90, 100] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'הפעולה נכשלה');
        return;
      }
      setResults(data.results);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="card">
      <h2 className="font-medium">הגדר תקציב לכל האתרים בבת אחת</h2>
      <p className="mt-1 text-xs text-stone-400">
        חל רק על אתרים שעדיין אין להם תקציב — לא דורס תקציבים קיימים. ספי
        התראה: 50% / 75% / 90% / 100%.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-stone-400">סכום חודשי לכל אתר</label>
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
          {isPending ? 'מגדיר...' : 'הגדר לכולם'}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {results && (
        <ul className="mt-3 space-y-1 text-xs">
          {results.map((r) => (
            <li key={r.site} className={r.ok ? 'text-green-400' : 'text-red-400'}>
              {r.site}: {r.message}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
