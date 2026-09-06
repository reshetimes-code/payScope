// Persistence layer for the Render connector — mirrors
// lib/providers/openai/sync.ts's split (adapter.ts stays pure provider
// mechanics, this orchestrates it against Prisma). Discovery only — no cost
// sync (see adapter.ts capabilities comment).

import { prisma } from '@/lib/db/prisma';
import { createRenderAdapter, RENDER_ACCOUNT_EXTERNAL_ID } from './adapter';

export async function ensureRenderConnection() {
  const existing = await prisma.providerConnection.findFirst({ where: { provider: 'RENDER' } });
  if (existing) return existing;

  return prisma.providerConnection.create({
    data: {
      provider: 'RENDER',
      displayName: 'Render',
      status: 'PENDING',
      authType: 'ADMIN_API_KEY',
    },
  });
}

async function ensureRenderAccount(providerConnectionId: string) {
  return prisma.providerAccount.upsert({
    where: {
      providerConnectionId_externalAccountId: {
        providerConnectionId,
        externalAccountId: RENDER_ACCOUNT_EXTERNAL_ID,
      },
    },
    create: {
      providerConnectionId,
      externalAccountId: RENDER_ACCOUNT_EXTERNAL_ID,
      displayName: 'Render',
      accountType: 'workspace',
    },
    update: {},
  });
}

export interface RenderDiscoverySummary {
  resources: number;
  errors: string[];
}

/** Discovery — lists every service + Postgres instance visible to the API key. Idempotent, same upsert-by-natural-key approach as Google's/OpenAI's. */
export async function runRenderDiscoverySync(): Promise<RenderDiscoverySummary> {
  const connection = await ensureRenderConnection();
  const job = await prisma.syncJob.create({
    data: { providerConnectionId: connection.id, jobType: 'render_discovery' },
  });

  const errors: string[] = [];
  const adapter = createRenderAdapter();

  try {
    const account = await ensureRenderAccount(connection.id);
    const resources = await adapter.discoverResources(RENDER_ACCOUNT_EXTERNAL_ID);

    for (const resource of resources) {
      await prisma.providerResource.upsert({
        where: {
          providerConnectionId_resourceType_externalResourceId: {
            providerConnectionId: connection.id,
            resourceType: resource.resourceType,
            externalResourceId: resource.externalResourceId,
          },
        },
        create: {
          providerConnectionId: connection.id,
          providerAccountId: account.id,
          externalResourceId: resource.externalResourceId,
          resourceType: resource.resourceType,
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

    return { resources: resources.length, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Render discovery error';
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
