import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { runGoogleCostSync, runGoogleBudgetSync } from '@/lib/providers/google/sync';
import { evaluateGoogleBudgets } from '@/lib/alerts/evaluate-budgets';
import { getGoogleAuthClientFromSession } from '@/lib/providers/google/user-auth';
import { writeAuditLog } from '@/lib/audit/log';

// Manual "sync now" for interactive use (the scheduled equivalent is
// /api/internal/sync/google, OIDC-only). Same underlying functions, just
// triggered by an admin click instead of Cloud Scheduler.
const bodySchema = z.object({ days: z.number().min(1).max(120).default(90) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const days = parsed.success ? parsed.data.days : 90;
  const correlationId = randomUUID();
  const authClient = getGoogleAuthClientFromSession(session) ?? undefined;

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);

  try {
    const costs = await runGoogleCostSync(from, now, authClient);
    // Before alerting, so budgets set directly in Google are evaluated too.
    const budgets = await runGoogleBudgetSync(authClient).catch((e) => ({
      error: e instanceof Error ? e.message : 'budget sync failed',
    }));
    const alerts = await evaluateGoogleBudgets(now);

    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'google.syncCosts',
      provider: 'GOOGLE_CLOUD',
      newValue: { costs, budgets, alerts },
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });

    return NextResponse.json({ costs, budgets, alerts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cost sync failed';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'google.syncCosts',
      provider: 'GOOGLE_CLOUD',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
