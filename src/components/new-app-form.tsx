'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface UnmappedResource {
  id: string;
  displayName: string;
  externalResourceId: string;
  resourceType: string;
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  gcp_project: 'Google',
  render_service: 'Render',
  render_postgres: 'Render',
};

// Creates a site and maps the selected Google Cloud projects to it in one
// step — chains POST /api/apps → POST /api/apps/:id/mappings per selection,
// instead of making the user create the site then separately visit its page
// to map each project (spec functionality unchanged, just one form instead
// of two screens).
export function NewAppForm({ unmappedResources }: { unmappedResources: UnmappedResource[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const createRes = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain: domain || undefined }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        setError(typeof createData.error === 'string' ? createData.error : 'יצירת האתר נכשלה');
        return;
      }

      const appId = createData.app.id as string;
      const failedMappings: string[] = [];

      for (const providerResourceId of selectedIds) {
        const res = await fetch(`/api/apps/${appId}/mappings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerResourceId, allocationMode: 'FULL' }),
        });
        if (!res.ok) {
          const resource = unmappedResources.find((r) => r.id === providerResourceId);
          failedMappings.push(resource?.displayName ?? providerResourceId);
        }
      }

      if (failedMappings.length > 0) {
        setError(`האתר נוצר, אך המיפוי נכשל עבור: ${failedMappings.join(', ')}`);
      }

      setName('');
      setDomain('');
      setSelectedIds([]);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 card">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs text-stone-400">שם האתר</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full field"
            placeholder="Mishpatly"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-stone-400">דומיין (אופציונלי)</label>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            dir="ltr"
            className="mt-1 w-full field"
            placeholder="mishpatly.co.il"
          />
        </div>
        <button
          type="submit"
          disabled={isPending || !name}
          className="btn-primary"
        >
          {isPending ? 'יוצר...' : 'צור אתר'}
        </button>
      </div>

      {unmappedResources.length > 0 && (
        <div>
          <label className="block text-xs text-stone-400">
            משאבים של האתר הזה — Google Cloud / Render (אופציונלי, אפשר לבחור כמה)
          </label>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-stone-800 p-2">
            {unmappedResources.map((r) => (
              <label key={r.id} className="flex items-center gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <span className="rounded-full bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-400">
                  {RESOURCE_TYPE_LABELS[r.resourceType] ?? r.resourceType}
                </span>
                {r.displayName}
                <span className="text-xs text-stone-500" dir="ltr">
                  ({r.externalResourceId})
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
