// Render BillingProviderAdapter — pure provider mechanics, same split as
// lib/providers/openai/adapter.ts: no Prisma here, that's ./sync.ts.

import type {
  BillingProviderAdapter,
  ConnectionTestResult,
  ProviderAccountDTO,
  ProviderResourceDTO,
  CostSyncInput,
  NormalizedCostRecord,
  ProviderBudget,
  ProviderCapabilities,
} from '@/lib/providers/types';
import { listServices, listPostgresInstances, getLatestDeployStatus, testApiKey } from './client';

// Render doesn't split resources across multiple billed "accounts" the way
// a GCP org does — one API key sees exactly one Render account/workspace.
export const RENDER_ACCOUNT_EXTERNAL_ID = 'render-workspace';

export const renderCapabilities: ProviderCapabilities = {
  // Render bills flat-rate per plan, not metered usage — there's no
  // per-resource cost API to read, unlike GCP/OpenAI. This connector is
  // for inventory visibility only (spec: owner asked to "see all the sites
  // for indication"), not cost tracking.
  canReadCosts: false,
  canReadBudgets: false,
  canWriteBudgets: false,
  hasProviderHardCap: false,
  supportsEmergencyShutdown: false,
  supportsProjectBreakdown: false,
  stopAction: 'MANUAL_ACTION_REQUIRED',
};

export function createRenderAdapter(): BillingProviderAdapter {
  return {
    provider: 'RENDER',
    capabilities: renderCapabilities,

    async testConnection(): Promise<ConnectionTestResult> {
      const result = await testApiKey();
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      return { ok: true, message: result.message };
    },

    async discoverAccounts(): Promise<ProviderAccountDTO[]> {
      return [
        {
          externalAccountId: RENDER_ACCOUNT_EXTERNAL_ID,
          displayName: 'Render',
          accountType: 'workspace',
        },
      ];
    },

    async discoverResources(_accountExternalId: string): Promise<ProviderResourceDTO[]> {
      const [services, databases] = await Promise.all([listServices(), listPostgresInstances()]);

      // N+1, but the account only has a handful of services — fetching each
      // one's latest deploy is the only way Render's API exposes a live
      // "Deployed / Failed deploy" style status (the service object itself
      // carries no status field).
      const serviceResources = await Promise.all(
        services.map(async (s): Promise<ProviderResourceDTO> => {
          const deployStatus = await getLatestDeployStatus(s.id).catch(() => null);
          return {
            externalResourceId: s.id,
            resourceType: 'render_service',
            displayName: s.name,
            status: s.suspended === 'suspended' ? 'suspended' : (deployStatus ?? 'unknown'),
            metadata: {
              type: s.type,
              region: s.region,
              plan: s.plan,
              url: s.url,
              dashboardUrl: s.dashboardUrl,
              updatedAt: s.updatedAt,
            },
          };
        }),
      );

      const dbResources: ProviderResourceDTO[] = databases.map((d) => ({
        externalResourceId: d.id,
        resourceType: 'render_postgres',
        displayName: d.name,
        status: d.suspended === 'suspended' ? 'suspended' : d.status,
        metadata: {
          region: d.region,
          plan: d.plan,
          dashboardUrl: d.dashboardUrl,
          updatedAt: d.updatedAt,
        },
      }));

      return [...serviceResources, ...dbResources];
    },

    async syncCosts(_input: CostSyncInput): Promise<NormalizedCostRecord[]> {
      // See capabilities.canReadCosts comment above.
      return [];
    },

    async getBudgets(): Promise<ProviderBudget[]> {
      return [];
    },

    async disconnect(): Promise<void> {
      // No provider-side session — disconnect is a DB-level status change,
      // handled by ./sync.ts.
    },
  };
}
