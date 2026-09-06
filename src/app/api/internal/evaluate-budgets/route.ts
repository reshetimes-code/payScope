import { NextResponse } from 'next/server';
import { verifyInternalRequest } from '@/lib/auth/verify-internal';
import { evaluateGoogleBudgets } from '@/lib/alerts/evaluate-budgets';

// Standalone endpoint for a Cloud Scheduler entry that doesn't need a full
// cost re-sync — e.g. the 07:00 daily job (spec §16). The 3-hour sync job
// (/api/internal/sync/google) already calls evaluateGoogleBudgets() itself
// after every cost sync; this route exists for a cadence independent of
// that. Both are safe to run back-to-back: threshold anti-spam is keyed by
// monthly cycle (BudgetThreshold.triggerCycleKey), not by which endpoint
// fired it.
export async function POST(req: Request) {
  const verification = await verifyInternalRequest(req.headers.get('authorization'));
  if (!verification.ok) {
    console.error('Rejected /api/internal/evaluate-budgets request:', verification.reason);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const summary = await evaluateGoogleBudgets();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Evaluation failed';
    console.error('Budget evaluation job failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
