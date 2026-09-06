import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const alert = await prisma.alert.update({
    where: { id },
    data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
  });

  await writeAuditLog({
    actorLabel: session.user.email,
    action: 'alert.acknowledge',
    resource: id,
    newValue: alert,
    result: 'SUCCESS',
  });

  return NextResponse.json({ alert });
}
