// Persistence layer for the OpenAI connector — mirrors
// lib/providers/google/sync.ts's split (adapter.ts stays pure provider
// mechanics, this orchestrates it against Prisma). Simpler than Google's:
// OpenAI has exactly one pseudo billing-account (the org itself), so there's
// no per-billing-account fan-out or "unknown account" fallback to handle.

import { prisma } from '@/lib/db/prisma';
import { createOpenAiAdapter, OPENAI_ACCOUNT_EXTERNAL_ID } from './adapter';

export async function ensureOpenAiConnection() {
  const existing = await prisma.providerConnection.findFirst({ where: { provider: 'OPENAI' } });
  if (existing) return existing;

  return prisma.providerConnection.create({
    data: {
      provider: 'OPENAI',
      displayName: 'OpenAI',
      status: 'PENDING',
      authType: 'ADMIN_API_KEY',
    },
  });
}

async function ensureOpenAiAccount(providerConnectionId: string) {
  return prisma.providerAccount.upsert({
    where: {
      providerConnectionId_externalAccountId: {
        providerConnectionId,
        externalAccountId: OPENAI_ACCOUNT_EXTERNAL_ID,
      },
    },
    create: {
      providerConnectionId,
      externalAccountId: OPENAI_ACCOUNT_EXTERNAL_ID,
      displayName: 'OpenAI Organization',
      accountType: 'billing_account',
    },
    update: {},
  });
}

export interface OpenAiDiscoverySummary {
  projects: number;
  errors: string[];
}

/**
 * Discovery — lists every project visible to the Admin key. Idempotent,
 * same upsert-by-natural-key approach as Google's, and for the same reason
 * (see the ProviderResource model comment: identity is
 * providerConnectionId + resourceType + externalResourceId, not the
 * account, since that can't drift for OpenAI anyway — there's only one).
 */
export async function runOpenAiDiscoverySync(): Promise<OpenAiDiscoverySummary> {
  const connection = await ensureOpenAiConnection();
  const job = await prisma.syncJob.create({
    data: { providerConnectionId: connection.id, jobType: 'openai_discovery' },
  });

  const errors: string[] = [];
  const adapter = createOpenAiAdapter();

  try {
    const account = await ensureOpenAiAccount(connection.id);
    const resources = await adapter.discoverResources(OPENAI_ACCOUNT_EXTERNAL_ID);

    for (const resource of resources) {
      await prisma.providerResource.upsert({
        where: {
          providerConnectionId_resourceType_externalResourceId: {
            providerConnectionId: connection.id,
            resourceType: 'openai_project',
            externalResourceId: resource.externalResourceId,
          },
        },
        create: {
          providerConnectionId: connection.id,
          providerAccountId: account.id,
          externalResourceId: resource.externalResourceId,
          resourceType: 'openai_project',
          displayName: resource.displayName,
          status: resource.status,
          metadataJson: resource.metadata as object,
        },
        update: {
          displayName: resource.displayName,
          status: resource.status,
          lastSeenAt: new Date(),
          metadataJson: resource.metadata as object,
        },
      });
    }

    await prisma.providerConnection.update({
      where: { id: connection.id },
      data: { status: 'CONNECTED', lastSyncAt: new Date(), lastTestedAt: new Date(), syncError: null },
    });
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { finishedAt: new Date(), status: 'SUCCEEDED', recordsProcessed: resources.length },
    });

    return { projects: resources.length, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown OpenAI discovery error';
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

export interface OpenAiCostSyncSummary {
  recordsUpserted: number;
  errors: string[];
}

/**
 * Cost sync (spec §16 cadence, same 3h job as Google — see
 * api/internal/sync/openai). Requires discovery to have run first, same
 * fail-loud-not-silent rule as Google's cost sync.
 */
export async function runOpenAiCostSync(from: Date, to: Date): Promise<OpenAiCostSyncSummary> {
  const connection = await ensureOpenAiConnection();
  const job = await prisma.syncJob.create({
    data: { providerConnectionId: connection.id, jobType: 'openai_cost_sync' },
  });

  const errors: string[] = [];
  let recordsUpserted = 0;
  const adapter = createOpenAiAdapter();

  try {
    const account = await ensureOpenAiAccount(connection.id);
    const records = await adapter.syncCosts({
      providerAccountExternalId: OPENAI_ACCOUNT_EXTERNAL_ID,
      from,
      to,
    });

    for (const rec of records) {
      const resource = await prisma.providerResource.findUnique({
        where: {
          providerConnectionId_resourceType_externalResourceId: {
            providerConnectionId: connection.id,
            resourceType: 'openai_project',
            externalResourceId: rec.providerResourceExternalId,
          },
        },
      });

      if (!resource) {
        errors.push(`עלות עבור פרויקט OpenAI לא מוכר ${rec.providerResourceExternalId} — הרץ discovery תחילה.`);
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
          provider: 'OPENAI',
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
    errors.push(err instanceof Error ? err.message : 'OpenAI cost sync failed');
  }

  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: { lastSyncAt: new Date(), syncError: errors.length ? errors.join('; ') : null },
  });
  await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      finishedAt: new Date(),
      status: errors.length ? 'FAILED' : 'SUCCEEDED',
      recordsProcessed: recordsUpserted,
      error: errors.length ? errors.join('; ') : null,
    },
  });

  return { recordsUpserted, errors };
}
