// Thin REST client for the Render API (owner request — visibility into
// Render-hosted sites alongside Google Cloud). Requires an API key created
// under Account Settings → API Keys in the Render dashboard, configured as
// RENDER_API_KEY. Render has no per-resource usage-cost API the way GCP/
// OpenAI do (its plans are flat-rate, not metered) — see adapter.ts for how
// that's handled (costs simply aren't synced for this provider).

const API_BASE = 'https://api.render.com/v1';

function apiKey(): string {
  const key = process.env.RENDER_API_KEY;
  if (!key) {
    throw new Error('RENDER_API_KEY is not configured.');
  }
  return key;
}

async function renderFetch(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) {
      throw new Error(`Render API 401 — the key is invalid or was revoked. ${body}`);
    }
    throw new Error(`Render API GET ${path} failed: ${res.status} ${body}`);
  }

  return res.json();
}

export interface RenderService {
  id: string;
  name: string;
  type: string; // e.g. "web_service", "static_site", "background_worker", "cron_job", "private_service"
  region: string | null;
  plan: string | null;
  suspended: string; // "not_suspended" | "suspended"
  url: string | null;
  dashboardUrl: string;
  createdAt: string;
  updatedAt: string;
}

/** Every web/static/background/private/cron service in the account, paginated via cursor. */
export async function listServices(): Promise<RenderService[]> {
  const services: RenderService[] = [];
  let cursor: string | undefined;

  do {
    const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
    const data = (await renderFetch(`/services${query}`)) as {
      cursor?: string;
      service: {
        id: string;
        name: string;
        type: string;
        suspended: string;
        createdAt: string;
        updatedAt: string;
        dashboardUrl: string;
        serviceDetails?: { region?: string; plan?: string; url?: string };
      };
    }[];

    for (const row of data) {
      services.push({
        id: row.service.id,
        name: row.service.name,
        type: row.service.type,
        region: row.service.serviceDetails?.region ?? null,
        plan: row.service.serviceDetails?.plan ?? null,
        suspended: row.service.suspended,
        url: row.service.serviceDetails?.url ?? null,
        dashboardUrl: row.service.dashboardUrl,
        createdAt: row.service.createdAt,
        updatedAt: row.service.updatedAt,
      });
    }
    cursor = data.length === 100 ? data[data.length - 1]?.cursor : undefined;
  } while (cursor);

  return services;
}

/** The most recent deploy's status for one service — Render has no "current status" field on the service object itself. */
export async function getLatestDeployStatus(serviceId: string): Promise<string | null> {
  const data = (await renderFetch(`/services/${serviceId}/deploys?limit=1`)) as {
    deploy: { status: string };
  }[];
  return data[0]?.deploy.status ?? null;
}

export interface RenderPostgres {
  id: string;
  name: string;
  region: string | null;
  plan: string | null;
  status: string; // e.g. "available"
  suspended: string;
  dashboardUrl: string;
  createdAt: string;
  updatedAt: string;
}

/** Managed Postgres instances — a separate resource type from /services in Render's API. */
export async function listPostgresInstances(): Promise<RenderPostgres[]> {
  const instances: RenderPostgres[] = [];
  let cursor: string | undefined;

  do {
    const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
    const data = (await renderFetch(`/postgres${query}`)) as {
      cursor?: string;
      postgres: {
        id: string;
        name: string;
        region: string;
        plan: string;
        status: string;
        suspended: string;
        dashboardUrl: string;
        createdAt: string;
        updatedAt: string;
      };
    }[];

    for (const row of data) {
      instances.push({
        id: row.postgres.id,
        name: row.postgres.name,
        region: row.postgres.region ?? null,
        plan: row.postgres.plan ?? null,
        status: row.postgres.status,
        suspended: row.postgres.suspended,
        dashboardUrl: row.postgres.dashboardUrl,
        createdAt: row.postgres.createdAt,
        updatedAt: row.postgres.updatedAt,
      });
    }
    cursor = data.length === 100 ? data[data.length - 1]?.cursor : undefined;
  } while (cursor);

  return instances;
}

export async function testApiKey(): Promise<{ ok: boolean; message: string }> {
  try {
    await renderFetch('/services?limit=1');
    return { ok: true, message: 'Render API key verified.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Render connection failed.' };
  }
}
