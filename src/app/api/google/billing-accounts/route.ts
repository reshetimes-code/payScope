import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

// Reads from our DB only — no live Google API call. Run POST
// /api/google/discover first to populate/refresh this.
export async function GET() {
  const connection = await prisma.providerConnection.findFirst({
    where: { provider: 'GOOGLE_CLOUD' },
  });

  if (!connection) {
    return NextResponse.json({ connected: false, billingAccounts: [] });
  }

  const accounts = await prisma.providerAccount.findMany({
    where: { providerConnectionId: connection.id },
    include: { _count: { select: { resources: true } } },
  });

  return NextResponse.json({
    connected: true,
    status: connection.status,
    lastSyncAt: connection.lastSyncAt,
    syncError: connection.syncError,
    billingAccounts: accounts.map((a) => ({
      id: a.id,
      externalAccountId: a.externalAccountId,
      displayName: a.displayName,
      projectCount: a._count.resources,
    })),
  });
}
