'use client';

import { useState, useTransition } from 'react';

export function TestEmailButton() {
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  function send() {
    setStatus('idle');
    startTransition(async () => {
      const res = await fetch('/api/settings/test-email', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setStatus('ok');
      } else {
        setStatus('error');
        setMessage(typeof data.error === 'string' ? data.error : 'שליחה נכשלה');
      }
    });
  }

  return (
    <div className="mt-4">
      <button
        onClick={send}
        disabled={isPending}
        className="btn-primary"
      >
        {isPending ? 'שולח...' : 'שלח מייל בדיקה'}
      </button>
      {status === 'ok' && <p className="mt-2 text-sm text-green-400">נשלח! בדוק את תיבת הדואר.</p>}
      {status === 'error' && <p className="mt-2 text-sm text-red-400">{message}</p>}
    </div>
  );
}
