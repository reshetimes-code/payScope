import { NextResponse } from 'next/server';
import { verifyInternalRequest } from '@/lib/auth/verify-internal';
import { runGoogleDiscoverySync, runGoogleCostSync, runGoogleBudgetSync } from '@/lib/providers/google/sync';
import { evaluateGoogleBudgets } from '@/lib/alerts/evaluate-budgets';
import { executeGoogleHardStops } from '@/lib/alerts/execute-hard-stops';

// Hit by Cloud Scheduler (spec §16: discovery every 6h, detailed cost sync
// every 3h — both run together here for simplicity; split into two
// Scheduler jobs hitting the same endpoint with a `?job=` param later if the
// costs make that worth doing). NOT covered by proxy.ts's session check —
// verifyInternalRequest() is the only gate, so it must run first and fail
// closed.
export async function POST(req: Request) {
  const verification = await verifyInternalRequest(req.headers.get('authorization'));
  if (!verification.ok) {
    console.error('Rejected /api/internal/sync/google request:', verification.reason);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const from = new Date(now);
  // Small look-back window, not just "today" — billing export rows can be
  // corrected for a few days after initial export (spec §34.9), and the
  // natural-key upsert (schema.prisma CostRecord) makes re-syncing recent
  // days cheap and safe rather than something to avoid.
  from.setUTCDate(from.getUTCDate() - 3);

  try {
    const discovery = await runGoogleDiscoverySync();
    const costs = await runGoogleCostSync(from, now);
    // Evaluate thresholds against the numbers we just synced, not stale
    // ones — alerting off cost data from hours ago defeats the point of a
    // 3-hour sync cadence (spec §16).
    const budgets = await runGoogleBudgetSync().catch((e) => ({
      error: e instanceof Error ? e.message : 'budget sync failed',
    }));
    const alerts = await evaluateGoogleBudgets(now);
    // Runs after alerting, on the same freshly-synced numbers. Only ever
    // touches budgets with hardStopEnabled=true (spec §34.11 opt-in) — see
    // src/lib/alerts/execute-hard-stops.ts for every other precondition.
    const hardStops = await executeGoogleHardStops(now);
    return NextResponse.json({ discovery, costs, budgets, alerts, hardStops });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    console.error('Google sync job failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
