// Google Cloud BillingProviderAdapter — pure provider mechanics (spec §9).
// No Prisma/DB access here; that's the job of ./sync.ts, which calls this
// adapter and persists results. Keeping the split means the adapter can be
// unit-tested against real (or mocked) Google APIs without a database.

import { createHash } from 'crypto';
import type { OAuth2Client } from 'google-auth-library';
import type {
  BillingProviderAdapter,
  ConnectionTestResult,
  ProviderAccountDTO,
  ProviderResourceDTO,
  CostSyncInput,
  NormalizedCostRecord,
  ProviderBudget,
  SetBudgetInput,
  BudgetActionResult,
  ProviderCapabilities,
} from '@/lib/providers/types';
import { discoverAccessibleProjects, testResourceManagerAccess } from './resource-manager';
import { listBillingAccounts, getProjectBillingInfo } from './billing';
import { getBillingExportConfigFor } from './config';
import { queryDailyCosts, testBillingExport } from './bigquery';
import { listBudgets, upsertBudget } from './budgets';

// Coarse-grained, provider-level capability declaration for the UI (spec
// §21). Per-resource stop-action nuance (dedicated vs. shared project) is
// determined at execution time by lib/remediation/google.ts, not here.
export const googleCapabilities: ProviderCapabilities = {
  canReadCosts: true,
  canReadBudgets: true,
  canWriteBudgets: true,
  hasProviderHardCap: false, // Cloud Billing budgets alert; they don't themselves stop usage
  supportsEmergencyShutdown: true,
  supportsProjectBreakdown: true,
  stopAction: 'AUTOMATED_SERVICE_SHUTDOWN',
};

function rawHashOf(row: {
  projectId: string;
  usageDate: string;
  service: string;
  sku: string;
  currency: string;
  grossCost: number;
  credits: number;
}): string {
  return createHash('sha256')
    .update(
      [row.projectId, row.usageDate, row.service, row.sku, row.currency, row.grossCost, row.credits].join(
        '|',
      ),
    )
    .digest('hex');
}

/**
 * Factory, not a singleton — the auth identity to use (session-based user
 * token today, ADC/workload-identity later per DECISIONS.md) is only known
 * per request, not at module-load time. See lib/providers/google/user-auth.ts.
 */
export function createGoogleAdapter(authClient?: OAuth2Client): BillingProviderAdapter {
  return {
    provider: 'GOOGLE_CLOUD',
    capabilities: googleCapabilities,

    async testConnection(): Promise<ConnectionTestResult> {
      const resourceManagerResult = await testResourceManagerAccess(authClient);
      if (!resourceManagerResult.ok) {
        return {
          ok: false,
          message: resourceManagerResult.message,
          missingPermissions: ['resourcemanager.projects.list or .search'],
        };
      }

      try {
        await listBillingAccounts(authClient);
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Cloud Billing API call failed.',
          missingPermissions: ['billing.accounts.list'],
        };
      }

      return { ok: true, message: 'Google Cloud connection verified.' };
    },

    async discoverAccounts(): Promise<ProviderAccountDTO[]> {
      const accounts = await listBillingAccounts(authClient);
      return accounts.map((a) => ({
        externalAccountId: a.billingAccountId,
        displayName: a.displayName,
        accountType: 'billing_account',
        metadata: { open: a.open, resourceName: a.name },
      }));
    },

    async discoverResources(_accountExternalId: string): Promise<ProviderResourceDTO[]> {
      // Google's discovery isn't naturally scoped per billing account — a
      // single scan of accessible projects returns all of them, and each
      // project reports which billing account it's linked to. lib/providers/
      // google/sync.ts calls discoverAccessibleProjects()+getProjectBillingInfo
      // directly for this reason rather than going through this method; it's
      // still implemented here (returning every project regardless of the
      // requested account) so the adapter honors the shared interface.
      const projects = await discoverAccessibleProjects(authClient);
      return projects.map((p) => ({
        externalResourceId: p.projectId,
        resourceType: 'gcp_project',
        displayName: p.displayName,
        status: p.state,
        parentExternalId: p.parent,
        metadata: { projectNumber: p.projectNumber },
      }));
    },

    async syncCosts(input: CostSyncInput): Promise<NormalizedCostRecord[]> {
      // scopeExternalId here is expected to be a billing account id — see
      // lib/providers/google/sync.ts for how this is actually invoked, since
      // billing export tables are keyed by billing account, not by project.
      const billingAccountId = input.providerAccountExternalId;
      const config = getBillingExportConfigFor(billingAccountId);

      const exportTest = await testBillingExport(config, billingAccountId, authClient);
      if (!exportTest.hasDetailedExport && !exportTest.hasStandardExport) {
        throw new Error(
          `Billing export עדיין לא הוגדר עבור billing account ${billingAccountId}. ` + exportTest.message,
        );
      }

      const rows = await queryDailyCosts(
        config,
        billingAccountId,
        exportTest.hasDetailedExport,
        input.from,
        input.to,
        authClient,
      );

      return rows.map(
        (row): NormalizedCostRecord => ({
          providerResourceExternalId: row.projectId,
          usageDate: new Date(row.usageDate),
          currency: row.currency,
          grossCost: row.grossCost,
          credits: row.credits,
          netCost: row.netCost,
          service: row.service,
          sku: row.sku,
          sourceReference: `bigquery:${config.exportProjectId}.${config.datasetId}`,
          rawHash: rawHashOf(row),
        }),
      );
    },

    async getBudgets(): Promise<ProviderBudget[]> {
      // Requires a specific billing account — callers should use
      // lib/providers/google/budgets.ts#listBudgets directly per billing
      // account. This generic method isn't wired to a single implicit
      // account; kept minimal to satisfy the interface until multi-account
      // budget listing has a natural place to live.
      return [];
    },

    async setBudget(input: SetBudgetInput): Promise<BudgetActionResult> {
      try {
        const result = await upsertBudget(
          {
            billingAccountId: input.scopeExternalId.split('/')[0] ?? '',
            projectNumber: input.scopeExternalId.split('/')[1] ?? '',
            displayName: `cost-control-center-${input.scopeExternalId}`,
            amount: input.amount,
            currencyCode: input.currency,
            thresholdsPercent: input.thresholdsPercent,
          },
          authClient,
        );
        return { ok: true, providerBudgetId: result.name, message: 'Budget created/updated.' };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Failed to set Google budget.',
        };
      }
    },

    async disconnect(): Promise<void> {
      // No provider-side session to tear down for a service-account/workload
      // identity connection — disconnect is a DB-level status change, handled
      // by lib/providers/google/sync.ts.
    },
  };
}
