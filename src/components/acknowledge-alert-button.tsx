'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function AcknowledgeAlertButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function acknowledge() {
    startTransition(async () => {
      await fetch(`/api/alerts/${alertId}/acknowledge`, { method: 'POST' });
      router.refresh();
    });
  }

  return (
    <button
      onClick={acknowledge}
      disabled={isPending}
      className="text-xs underline text-stone-400 hover:text-stone-50 disabled:opacity-50"
    >
      {isPending ? '...' : 'סמן כטופל'}
    </button>
  );
}
