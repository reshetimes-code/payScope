'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

// Undo of AddMappingForm's POST — e.g. the underlying GCP project was shut
// down/deleted and this site should stop being attributed its costs.
export function RemoveMappingButton({
  managedAppId,
  providerResourceId,
}: {
  managedAppId: string;
  providerResourceId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm('להסיר את השיוך? עלויות שכבר יובאו לאתר זה מהמשאב הזה יוסרו מהסיכומים שלו.')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/apps/${managedAppId}/mappings?providerResourceId=${providerResourceId}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'הסרת השיוך נכשלה');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        onClick={remove}
        disabled={isPending}
        className="text-xs underline text-stone-400 hover:text-red-400 disabled:opacity-50"
      >
        {isPending ? '...' : 'הסר שיוך'}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
