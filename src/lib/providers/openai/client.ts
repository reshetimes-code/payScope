// Thin REST client for OpenAI's Admin API (spec §9 — OpenAI connector,
// Phase 2). Requires an *Admin* API key (created under Organization →
// Admin keys in the OpenAI dashboard) — a regular project API key cannot
// read org-wide costs/projects and every call here will 401.

const API_BASE = 'https://api.openai.com/v1/organization';

function adminKey(): string {
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) {
    throw new Error('OPENAI_ADMIN_KEY is not configured.');
  }
  return key;
}

async function openaiFetch(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${adminKey()}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) {
      throw new Error(
        `OpenAI API 401 — ה-key חייב להיות Admin key (Organization → Admin keys), לא project key. ${body}`,
      );
    }
    throw new Error(`OpenAI API GET ${path} failed: ${res.status} ${body}`);
  }

  return res.json();
}

export interface OpenAiProject {
  id: string;
  name: string;
  status: string;
  createdAt: number;
}

export async function listProjects(): Promise<OpenAiProject[]> {
  const projects: OpenAiProject[] = [];
  let after: string | undefined;

  do {
    const query = after ? `?after=${encodeURIComponent(after)}&limit=100` : '?limit=100';
    const data = (await openaiFetch(`/projects${query}`)) as {
      data?: { id: string; name: string; status: string; created_at: number }[];
      has_more?: boolean;
      last_id?: string;
    };

    (data.data ?? []).forEach((p) =>
      projects.push({ id: p.id, name: p.name, status: p.status, createdAt: p.created_at }),
    );
    after = data.has_more ? data.last_id : undefined;
  } while (after);

  return projects;
}

export interface OpenAiCostBucket {
  /** Unix seconds, start of the UTC day this bucket covers. */
  startTime: number;
  projectId: string | null;
  lineItem: string | null;
  amount: number;
  currency: string;
}

/**
 * Daily cost buckets grouped by project, spec §5.6 granularity. `from`/`to`
 * are inclusive UTC calendar days, mirroring lib/providers/google/bigquery.ts.
 */
export async function getCosts(from: Date, to: Date): Promise<OpenAiCostBucket[]> {
  const startTime = Math.floor(from.getTime() / 1000);
  const endTime = Math.floor(to.getTime() / 1000);

  const buckets: OpenAiCostBucket[] = [];
  let page: string | undefined;

  do {
    const params = new URLSearchParams({
      start_time: String(startTime),
      end_time: String(endTime),
      bucket_width: '1d',
      limit: '180',
    });
    params.append('group_by', 'project_id');
    params.append('group_by', 'line_item');
    if (page) params.set('page', page);

    const data = (await openaiFetch(`/costs?${params.toString()}`)) as {
      data?: {
        start_time: number;
        results?: {
          amount?: { value?: number; currency?: string };
          project_id?: string | null;
          line_item?: string | null;
        }[];
      }[];
      has_more?: boolean;
      next_page?: string;
    };

    for (const bucket of data.data ?? []) {
      for (const result of bucket.results ?? []) {
        buckets.push({
          startTime: bucket.start_time,
          projectId: result.project_id ?? null,
          lineItem: result.line_item ?? null,
          amount: result.amount?.value ?? 0,
          currency: (result.amount?.currency ?? 'usd').toUpperCase(),
        });
      }
    }
    page = data.has_more ? data.next_page : undefined;
  } while (page);

  return buckets;
}

export async function testAdminKey(): Promise<{ ok: boolean; message: string }> {
  try {
    await openaiFetch('/projects?limit=1');
    return { ok: true, message: 'OpenAI Admin key verified.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'OpenAI connection failed.' };
  }
}
