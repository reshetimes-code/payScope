// OpenAI BillingProviderAdapter — pure provider mechanics (spec §9), same
// split as lib/providers/google/adapter.ts: no Prisma here, that's ./sync.ts.

import { createHash } from 'crypto';
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
import { listProjects, getCosts, testAdminKey } from './client';

// OpenAI orgs aren't split into separately-billed "accounts" the way a GCP
// org has multiple billing accounts — there's exactly one, the
// organization itself. This fixed id is that pseudo-account.
export const OPENAI_ACCOUNT_EXTERNAL_ID = 'openai-organization';

export const openaiCapabilities: ProviderCapabilities = {
  canReadCosts: true,
  canReadBudgets: false, // no public API for org spend limits as of this build
  canWriteBudgets: false,
  hasProviderHardCap: false,
  supportsEmergencyShutdown: true,
  supportsProjectBreakdown: true,
  // Nothing scoped like Cloud Run's max-instances=0 exists for a project —
  // the only real stop lever OpenAI exposes is disabling/rotating the API
  // key(s) tied to the overspending project (spec §34.2).
  stopAction: 'API_KEY_DISABLE_OR_ROTATION',
};

function rawHashOf(row: {
  projectId: string;
  usageDate: string;
  lineItem: string;
  currency: string;
  amount: number;
}): string {
  return createHash('sha256')
    .update([row.projectId, row.usageDate, row.lineItem, row.currency, row.amount].join('|'))
    .digest('hex');
}

export function createOpenAiAdapter(): BillingProviderAdapter {
  return {
    provider: 'OPENAI',
    capabilities: openaiCapabilities,

    async testConnection(): Promise<ConnectionTestResult> {
      const result = await testAdminKey();
      if (!result.ok) {
        return { ok: false, message: result.message, missingPermissions: ['organization.read (Admin key)'] };
      }
      return { ok: true, message: result.message };
    },

    async discoverAccounts(): Promise<ProviderAccountDTO[]> {
      // Single pseudo-account, see OPENAI_ACCOUNT_EXTERNAL_ID above.
      return [
        {
          externalAccountId: OPENAI_ACCOUNT_EXTERNAL_ID,
          displayName: 'OpenAI Organization',
          accountType: 'billing_account',
        },
      ];
    },

    async discoverResources(_accountExternalId: string): Promise<ProviderResourceDTO[]> {
      const projects = await listProjects();
      return projects.map((p) => ({
        externalResourceId: p.id,
        resourceType: 'openai_project',
        displayName: p.name,
        status: p.status,
        metadata: { createdAt: p.createdAt },
      }));
    },

    async syncCosts(input: CostSyncInput): Promise<NormalizedCostRecord[]> {
      const buckets = await getCosts(input.from, input.to);

      return buckets
        .filter((b) => b.projectId) // costs with no project_id are org-level (e.g. legacy/unassigned) — spec §11 shows these separately, not attributed to a project
        .map((b): NormalizedCostRecord => {
          const usageDate = new Date(b.startTime * 1000);
          const lineItem = b.lineItem ?? '';
          return {
            providerResourceExternalId: b.projectId as string,
            usageDate,
            currency: b.currency,
            grossCost: b.amount,
            credits: 0, // OpenAI's costs API doesn't break out credits separately
            netCost: b.amount,
            service: 'OpenAI API',
            sku: lineItem,
            sourceReference: 'openai:organization/costs',
            rawHash: rawHashOf({
              projectId: b.projectId as string,
              usageDate: usageDate.toISOString().slice(0, 10),
              lineItem,
              currency: b.currency,
              amount: b.amount,
            }),
          };
        });
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
