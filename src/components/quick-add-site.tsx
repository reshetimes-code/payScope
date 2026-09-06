'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

// "Type a URL, get a site" — the simple front door to app creation. Falls
// back to the full manual form below it (NewAppForm) when the automatic
// name-match is ambiguous or finds nothing, rather than ever guessing.
export function QuickAddSite() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'info' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const res = await fetch('/api/apps/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ kind: 'error', text: typeof data.error === 'string' ? data.error : 'משהו נכשל' });
        return;
      }

      if (data.result === 'matched') {
        setMessage({ kind: 'ok', text: `חובר! "${data.app.name}" מופה אוטומטית לפרויקט ${data.matchedProject.externalResourceId}.` });
        setUrl('');
        router.refresh();
      } else if (data.result === 'ambiguous') {
        setMessage({
          kind: 'info',
          text: `${data.message} (${data.candidates.map((c: { displayName: string }) => c.displayName).join(', ')}) — תבחר ידנית בטופס למטה.`,
        });
      } else {
        setMessage({ kind: 'info', text: data.message });
      }
    });
  }

  return (
    <form onSubmit={submit} className="card">
      <label className="block text-xs text-stone-400">כתובת אתר — הכי פשוט</label>
      <div className="mt-1 flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          dir="ltr"
          required
          placeholder="mishpatly.co.il"
          className="flex-1 field"
        />
        <button
          type="submit"
          disabled={isPending || !url}
          className="btn-primary"
        >
          {isPending ? 'מחפש...' : 'הוסף אוטומטית'}
        </button>
      </div>
      <p className="mt-1 text-xs text-stone-500">
        המערכת תנסה למצוא לבד את פרויקט ה-Google Cloud המתאים לפי שם הכתובת.
        אם לא מוצאת חד-משמעית — תבקש ממך לבחור ידנית למטה.
      </p>
      {message && (
        <p
          className={`mt-2 text-sm ${
            message.kind === 'ok' ? 'text-green-400' : message.kind === 'error' ? 'text-red-400' : 'text-orange-400'
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
