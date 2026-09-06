import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { runOpenAiCostSync } from '@/lib/providers/openai/sync';
import { writeAuditLog } from '@/lib/audit/log';

// Manual "sync now" for interactive use — the scheduled equivalent is
// /api/internal/sync/openai (OIDC-only), same underlying function.
const bodySchema = z.object({ days: z.number().min(1).max(120).default(90) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const days = parsed.success ? parsed.data.days : 90;
  const correlationId = randomUUID();

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);

  try {
    const costs = await runOpenAiCostSync(from, now);
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'openai.syncCosts',
      provider: 'OPENAI',
      newValue: costs,
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });
    return NextResponse.json(costs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cost sync failed';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'openai.syncCosts',
      provider: 'OPENAI',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
