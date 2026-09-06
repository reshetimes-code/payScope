'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Row {
  name: string;
  amount: string;
}

function previousMonth(): { year: number; month: number } {
  const now = new Date();
  const m = now.getUTCMonth(); // 0-11, so this is already "previous month" as a 1-based value
  return m === 0 ? { year: now.getUTCFullYear() - 1, month: 12 } : { year: now.getUTCFullYear(), month: m };
}

export function RenderInvoiceForm({ defaultServiceNames }: { defaultServiceNames: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { year: defaultYear, month: defaultMonth } = previousMonth();
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [rows, setRows] = useState<Row[]>(
    defaultServiceNames.length > 0 ? defaultServiceNames.map((name) => ({ name, amount: '' })) : [{ name: '', amount: '' }],
  );

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { name: '', amount: '' }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  function submit() {
    setError(null);
    const lines = rows
      .filter((r) => r.name.trim() && r.amount.trim())
      .map((r) => ({ name: r.name.trim(), amount: Number(r.amount) }));

    if (lines.length === 0) {
      setError('צריך לפחות שורה אחת עם שם וסכום');
      return;
    }
    if (lines.some((l) => !Number.isFinite(l.amount) || l.amount < 0)) {
      setError('אחד הסכומים לא תקין');
      return;
    }

    startTransition(async () => {
      const res = await fetch('/api/render/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, lines }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'יצירת החשבונית נכשלה');
        return;
      }
      router.push('/invoices');
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4">
      <div className="flex gap-3">
        <label className="flex-1 text-sm">
          חודש
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="field mt-1 w-full">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 text-sm">
          שנה
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="field mt-1 w-full"
          />
        </label>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="שם שירות"
              value={row.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              className="field flex-1"
              dir="ltr"
            />
            <input
              type="number"
              step="0.01"
              placeholder="$"
              value={row.amount}
              onChange={(e) => updateRow(i, { amount: e.target.value })}
              className="field w-28"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="rounded-md px-2 py-1 text-stone-500 hover:bg-stone-800 hover:text-red-400"
              title="הסר שורה"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={addRow} className="text-sm text-purple-400 hover:text-purple-300">
        + הוסף שורה
      </button>

      <div className="flex items-center justify-between border-t border-stone-800 pt-4">
        <span className="text-sm text-stone-400">
          סה״כ: <span className="font-medium text-stone-100">${total.toFixed(2)}</span>
        </span>
        <button onClick={submit} disabled={isPending} className="btn-primary">
          {isPending ? 'שומר...' : 'צור חשבונית'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/20">{error}</p>
      )}
    </div>
  );
}
