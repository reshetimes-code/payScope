// Persistence layer for the Google Cloud connector — the only place in this
// connector that touches Prisma. lib/providers/google/adapter.ts stays pure
// provider mechanics; this file orchestrates it against the database and is
// what API routes / the internal scheduler endpoint actually call.

import type { OAuth2Client } from 'google-auth-library';
import { prisma } from '@/lib/db/prisma';
import { discoverAccessibleProjects } from './resource-manager';
import { listBillingAccounts, getProjectBillingInfo } from './billing';
import { createGoogleAdapter } from './adapter';
import { listBudgets } from './budgets';

const UNKNOWN_BILLING_ACCOUNT_EXTERNAL_ID = 'unknown';

export async function ensureGoogleConnection() {
  const existing = await prisma.providerConnection.findFirst({
    where: { provider: 'GOOGLE_CLOUD' },
  });
  if (existing) return existing;

  return prisma.providerConnection.create({
    data: {
      provider: 'GOOGLE_CLOUD',
      displayName: 'Google Cloud',
      status: 'PENDING',
      // See DECISIONS.md "GCP credential strategy" — workload identity is the
      // default; a downloaded key is a local-dev-only fallback.
      authType: process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? 'SERVICE_ACCOUNT_KEY'
        : 'WORKLOAD_IDENTITY',
    },
  });
}

async function ensureUnknownBillingAccount(providerConnectionId: string) {
  return prisma.providerAccount.upsert({
    where: {
      providerConnectionId_externalAccountId: {
        providerConnectionId,
        externalAccountId: UNKNOWN_BILLING_ACCOUNT_EXTERNAL_ID,
      },
    },
    create: {
      providerConnectionId,
      externalAccountId: UNKNOWN_BILLING_ACCOUNT_EXTERNAL_ID,
      displayName: 'ללא billing account מזוהה',
      accountType: 'billing_account',
    },
    update: {},
  });
}

export interface DiscoverySummary {
  billingAccounts: number;
  projects: number;
  projectsWithoutKnownBillingAccount: number;
  errors: string[];
}

/**
 * Setup wizard steps 2-3 (spec §17) and the periodic "resource discovery"
 * schedule (spec §16, every 6h). Idempotent — safe to run repeatedly; every
 * write is an upsert keyed by the provider's own stable ids.
 */
export async function runGoogleDiscoverySync(authClient?: OAuth2Client): Promise<DiscoverySummary> {
  const connection = await ensureGoogleConnection();
  const job = await prisma.syncJob.create({
    data: { providerConnectionId: connection.id, jobType: 'google_discovery' },
  });

  const errors: string[] = [];
  let projectsWithoutKnownBillingAccount = 0;

  try {
    const billingAccounts = await listBillingAccounts(authClient);
    const providerAccountIdByBillingAccountId = new Map<string, string>();

    for (const acct of billingAccounts) {
      const rec = await prisma.providerAccount.upsert({
        where: {
          providerConnectionId_externalAccountId: {
            providerConnectionId: connection.id,
            externalAccountId: acct.billingAccountId,
          },
        },
        create: {
          providerConnectionId: connection.id,
          externalAccountId: acct.billingAccountId,
          displayName: acct.displayName,
          accountType: 'billing_account',
          metadataJson: { open: acct.open, resourceName: acct.name },
        },
        update: {
          displayName: acct.displayName,
          metadataJson: { open: acct.open, resourceName: acct.name },
        },
      });
      providerAccountIdByBillingAccountId.set(acct.billingAccountId, rec.id);
    }

    const projects = await discoverAccessibleProjects(authClient);

    for (const project of projects) {
      let billingAccountName: string | null = null;
      let billingEnabled = false;

      try {
        const info = await getProjectBillingInfo(project.projectId, authClient);
        billingAccountName = info.billingAccountName;
        billingEnabled = info.billingEnabled;
      } catch (err) {
        errors.push(
          `${project.projectId}: ${err instanceof Error ? err.message : 'billing info lookup failed'}`,
        );
      }

      const billingAccountId = billingAccountName?.replace(/^billingAccounts\//, '') ?? null;
      let providerAccountId = billingAccountId
        ? providerAccountIdByBillingAccountId.get(billingAccountId)
        : undefined;

      if (!providerAccountId) {
        // Visible via Resource Manager but its billing account isn't one we
        // could enumerate (billing disabled, or the account is outside this
        // identity's IAM grant). Keep it visible under a placeholder account
        // instead of dropping it — spec §11 requires unmapped/unexplained
        // spend to never go silently missing.
        projectsWithoutKnownBillingAccount++;
        const unknown = await ensureUnknownBillingAccount(connection.id);
        providerAccountId = unknown.id;
      }

      await prisma.providerResource.upsert({
        where: {
          providerConnectionId_resourceType_externalResourceId: {
            providerConnectionId: connection.id,
            resourceType: 'gcp_project',
            externalResourceId: project.projectId,
          },
        },
        create: {
          providerConnectionId: connection.id,
          providerAccountId,
          externalResourceId: project.projectId,
          resourceType: 'gcp_project',
          displayName: project.displayName,
          status: project.state,
          parentExternalId: project.parent,
          metadataJson: { projectNumber: project.projectNumber, billingEnabled },
        },
        // providerAccountId is intentionally updated here too — a project's
        // billing account can change between syncs (disabled/re-enabled,
        // moved), and that must move the existing row, not spawn a new one.
        // See the ProviderResource model comment for why the unique key
        // above no longer includes providerAccountId.
        update: {
          providerAccountId,
          displayName: project.displayName,
          status: project.state,
          lastSeenAt: new Date(),
          metadataJson: { projectNumber: project.projectNumber, billingEnabled },
        },
      });
    }

    await prisma.providerConnection.update({
      where: { id: connection.id },
      data: {
        status: 'CONNECTED',
        lastSyncAt: new Date(),
        lastTestedAt: new Date(),
        syncError: errors.length ? errors.join('; ') : null,
      },
    });

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        finishedAt: new Date(),
        status: errors.length ? 'FAILED' : 'SUCCEEDED',
        recordsProcessed: billingAccounts.length + projects.length,
        error: errors.length ? errors.join('; ') : null,
      },
    });

    return {
      billingAccounts: billingAccounts.length,
      projects: projects.length,
      projectsWithoutKnownBillingAccount,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown discovery error';
    await prisma.providerConnection.update({
      where: { id: connection.id },
      data: { status: 'ERROR', syncError: message },
    });
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { finishedAt: new Date(), status: 'FAILED', error: message },
    });
    throw err;
  }
}

export interface CostSyncSummary {
  billingAccountsProcessed: number;
  recordsUpserted: number;
  errors: string[];
}

/**
 * Detailed BigQuery cost sync (spec §16, every 3h). Requires discovery to
 * have run first — a cost row for a project we haven't discovered yet is
 * reported as an error rather than silently skipped or auto-created, so a
 * stale discovery cache doesn't quietly hide new spend.
 */
export async function runGoogleCostSync(
  from: Date,
  to: Date,
  authClient?: OAuth2Client,
): Promise<CostSyncSummary> {
  const connection = await ensureGoogleConnection();
  const job = await prisma.syncJob.create({
    data: { providerConnectionId: connection.id, jobType: 'google_bigquery_cost_sync' },
  });

  const errors: string[] = [];
  let recordsUpserted = 0;

  const accounts = await prisma.providerAccount.findMany({
    where: { providerConnectionId: connection.id, accountType: 'billing_account' },
  });
  const adapter = createGoogleAdapter(authClient);

  for (const account of accounts) {
    if (account.externalAccountId === UNKNOWN_BILLING_ACCOUNT_EXTERNAL_ID) continue;

    try {
      const records = await adapter.syncCosts({
        providerAccountExternalId: account.externalAccountId,
        from,
        to,
      });

      for (const rec of records) {
        // Looked up by connection + externalResourceId, not by this
        // specific billing account — a project's billing export can list
        // it under an account that discovery has since moved it away from
        // (see the ProviderResource model comment), and it's still the
        // same resource for cost-recording purposes.
        const resource = await prisma.providerResource.findUnique({
          where: {
            providerConnectionId_resourceType_externalResourceId: {
              providerConnectionId: connection.id,
              resourceType: 'gcp_project',
              externalResourceId: rec.providerResourceExternalId,
            },
          },
        });

        if (!resource) {
          errors.push(
            `עלות עבור פרויקט לא מוכר ${rec.providerResourceExternalId} ` +
              `(billing account ${account.externalAccountId}) — הרץ discovery תחילה.`,
          );
          continue;
        }

        const mapping = await prisma.appResourceMapping.findFirst({
          where: { providerResourceId: resource.id },
        });

        const service = rec.service ?? '';
        const sku = rec.sku ?? '';

        await prisma.costRecord.upsert({
          where: {
            cost_record_natural_key: {
              providerResourceId: resource.id,
              usageDate: rec.usageDate,
              service,
              sku,
              currency: rec.currency,
            },
          },
          create: {
            provider: 'GOOGLE_CLOUD',
            providerAccountId: account.id,
            providerResourceId: resource.id,
            managedAppId: mapping?.managedAppId,
            usageDate: rec.usageDate,
            currency: rec.currency,
            grossCost: rec.grossCost,
            credits: rec.credits,
            netCost: rec.netCost,
            service,
            sku,
            sourceReference: rec.sourceReference,
            rawHash: rec.rawHash,
          },
          update: {
            grossCost: rec.grossCost,
            credits: rec.credits,
            netCost: rec.netCost,
            rawHash: rec.rawHash,
            managedAppId: mapping?.managedAppId,
            importedAt: new Date(),
          },
        });
        recordsUpserted++;
      }
    } catch (err) {
      errors.push(
        `${account.externalAccountId}: ${err instanceof Error ? err.message : 'cost sync failed'}`,
      );
    }
  }

  await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      finishedAt: new Date(),
      status: errors.length ? 'FAILED' : 'SUCCEEDED',
      recordsProcessed: recordsUpserted,
      error: errors.length ? errors.join('; ') : null,
    },
  });
  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: { lastSyncAt: new Date() },
  });

  return { billingAccountsProcessed: accounts.length, recordsUpserted, errors };
}

export interface BudgetSyncSummary {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Pulls budgets that already exist in Google (e.g. created directly in the
 * Cloud Console, not via this app) into the Budget table, so the dashboard
 * and /budgets show what Google actually has. Only project-scoped budgets
 * are imported — an account-wide budget has no single PROVIDER_RESOURCE to
 * attach to. Google's amount/currency win over the local copy.
 */
export async function runGoogleBudgetSync(authClient?: OAuth2Client): Promise<BudgetSyncSummary> {
  const summary: BudgetSyncSummary = { imported: 0, updated: 0, skipped: 0, errors: [] };
  const accounts = await prisma.providerAccount.findMany({
    where: {
      accountType: 'billing_account',
      externalAccountId: { not: UNKNOWN_BILLING_ACCOUNT_EXTERNAL_ID },
      connection: { provider: 'GOOGLE_CLOUD' },
    },
    include: { resources: true },
  });

  for (const account of accounts) {
    let budgets;
    try {
      budgets = await listBudgets(account.externalAccountId, authClient);
    } catch (err) {
      summary.errors.push(
        `${account.externalAccountId}: ${err instanceof Error ? err.message : 'budget list failed'}`,
      );
      continue;
    }

    for (const b of budgets) {
      const resource =
        b.scopedProjectNumbers.length === 1
          ? account.resources.find(
              (r) => (r.metadataJson as { projectNumber?: string } | null)?.projectNumber === b.scopedProjectNumbers[0],
            )
          : undefined;
      if (!resource || b.amount <= 0) {
        summary.skipped++;
        continue;
      }

      const existing =
        (await prisma.budget.findFirst({ where: { providerBudgetId: b.name } })) ??
        (await prisma.budget.findFirst({
          where: { scopeType: 'PROVIDER_RESOURCE', scopeId: resource.id, provider: 'GOOGLE_CLOUD' },
        }));

      if (existing) {
        await prisma.budget.update({
          where: { id: existing.id },
          data: { amount: b.amount, currency: b.currencyCode, providerBudgetId: b.name, active: true },
        });
        summary.updated++;
      } else {
        const created = await prisma.budget.create({
          data: {
            scopeType: 'PROVIDER_RESOURCE',
            scopeId: resource.id,
            provider: 'GOOGLE_CLOUD',
            amount: b.amount,
            currency: b.currencyCode,
            enforcementType: 'PROVIDER_ALERT',
            providerBudgetId: b.name,
          },
        });
        for (const percent of b.thresholdsPercent) {
          await prisma.budgetThreshold.create({ data: { budgetId: created.id, percent } });
        }
        summary.imported++;
      }
    }
  }

  return summary;
}
